import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { FileAudio, History, Lock, LockOpen, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import {
  Dropdown, UiButton, UiChipButton, UiEmpty, UiFormRow, UiGroup, UiIconButton, UiOptionButton, UiRangeInput, UiSegmented, UiSwitch, UiTextArea, UiTextToken,
  UI_TEXT_META_CLASS, UI_TEXT_SECONDARY_CLASS,
} from '@/components/ui'
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { ICON_SETTINGS as SettingsIcon, UI_ICON_SIZE } from '@/core/theme/icons'
import { buildAudioEditCaptionGroups } from '@/core/audioEdit/captions'
import { normalizeAudioEditFiller } from '@/core/audioEdit/analysis'
import { DEFAULT_AUDIO_EDIT_SETTINGS, DEFAULT_AUDIO_EDIT_VIEW_SETTINGS } from '@/core/audioEdit/edits'
import { notificationMessage } from '@/i18n/notifications'
import { openDialog, readTextFile } from '@/platform/desktopApi'
import { AudioEditDisclosure } from '../AudioEditDisclosure'
import { AudioEditSuggestions } from '../AudioEditSuggestions'
import { AudioEditFindReplace, AudioEditMatchedText } from '../AudioEditTextTools'
import { cleanProjectAudioEditFillers, compressAudioEditSilence, detectProjectAudioEditMouthClicks, matchProjectAudioEditLoudness, processProjectAudioEditBreaths, quickProcessAudioEdit, transcribeAudioEdit } from '../application/audioEditApplicationService'
import type { AudioEditBreathPolicy } from '@/core/audioEdit/breaths'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'
import { audioEditHistoryEntries } from './audioEditHistory'
import { useAudioEditWorkspace } from './audioEditWorkspaceContext'
import { EssentialSoundControls } from '@/components/audio/EssentialSoundControls'
import { beginAudioEditGesture } from '../application/audioEditProjectInstances'

/** 减少混响、人声分离用本地模型离线处理进“编辑后声音”（主进程 prepareAudioEditRenderSource）。 */
const AUDIO_EDIT_OFFLINE_REPAIR = true

function formatTime(frames: number, sampleRate: number): string {
  const seconds = Math.max(0, frames / Math.max(1, sampleRate))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

/** 停靠面板的滚动内容区：统一内边距，面板之间读起来是同一套排版。 */
function PanelScroll({ children, label }: { children: React.ReactNode; label: string }) {
  return <section aria-label={label} className="h-full min-h-0 overflow-y-auto bg-panel p-3">{children}</section>
}

/** 滑杆行标签：名称 + 当前读数（读数用等宽数字，拖动时不跳宽）。 */
function RangeLabel({ name, value }: { name: string; value: string }): JSX.Element {
  return <span className="flex items-baseline justify-between gap-2"><span>{name}</span><span className="tabular-nums text-text3">{value}</span></span>
}

/** 逐字稿首尾留白（虚拟列表内部，避免外层 padding 把滚动条也推进来）。 */
function TranscriptEdge(): JSX.Element {
  return <div className="h-6" />
}

/** 文字稿：逐词剪辑。查找替换展开时在面板顶部。 */
export function AudioEditTranscriptPanel() {
  const workspace = useAudioEditWorkspace()
  const { project, disabled, textSearch: search } = workspace
  const activeBlockId = useAudioEditPlaybackStore((state) => state.activeBlockId)
  const mode = useAudioEditPlaybackStore((state) => state.mode)
  const selected = workspace.selectedBlockIds
  const listRef = useRef<VirtuosoHandle | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const followPausedUntilRef = useRef(0)
  const transcript = project.transcript
  const viewSettings = project.viewSettings ?? DEFAULT_AUDIO_EDIT_VIEW_SETTINGS
  const batchSettings = project.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS
  const fillers = useMemo(() => new Set(batchSettings.fillers.map(normalizeAudioEditFiller)), [batchSettings.fillers])
  const pauseFrames = batchSettings.silenceThresholdMs / 1000 * project.source.sampleRate
  const rows = useMemo(() => {
    if (transcript.some((block) => block.captionBreakAfter !== undefined)) return buildAudioEditCaptionGroups(transcript, project.source.sampleRate).map((group) => group.blocks)
    const next: typeof transcript[] = []
    for (let index = 0; index < transcript.length; index += 64) next.push(transcript.slice(index, index + 64))
    return next
  }, [transcript, project.source.sampleRate])
  const rowByBlock = useMemo(() => new Map(rows.flatMap((row, index) => row.map((block) => [block.id, index] as const))), [rows])
  // 原稿 / 校对后：校对过文字（改过识别出来的字）才出现切换；原稿只换显示的字，操作照常
  const originals = useMemo(() => new Map((project.editBaseline?.transcript ?? []).map((block) => [block.id, block.text])), [project.editBaseline])
  const corrected = useMemo(() => transcript.some((block) => originals.has(block.id) && originals.get(block.id) !== block.text), [transcript, originals])
  const [textView, setTextView] = useState<'original' | 'corrected'>('corrected')
  const showOriginal = corrected && textView === 'original'
  const activeRow = activeBlockId ? rowByBlock.get(activeBlockId) ?? -1 : -1

  useEffect(() => {
    if (search.currentMatch || activeRow < 0 || Date.now() < followPausedUntilRef.current) return
    listRef.current?.scrollIntoView({ index: activeRow, behavior: 'smooth', done: () => undefined })
  }, [activeRow, activeBlockId, search.currentMatch])

  useEffect(() => {
    const id = search.currentMatch?.blockIds[0]
    const index = id ? rowByBlock.get(id) ?? -1 : -1
    if (index < 0) return
    let disposed = false
    const reveal = () => { if (!disposed) containerRef.current?.querySelector('[data-audio-search-current="true"]')?.scrollIntoView({ block: 'center', inline: 'nearest' }) }
    if (containerRef.current?.querySelector('[data-audio-search-current="true"]')) reveal()
    else listRef.current?.scrollIntoView({ index, behavior: 'auto', done: () => { requestAnimationFrame(reveal) } })
    return () => { disposed = true }
  }, [search.navigationKey, search.currentMatch, rowByBlock])

  const configuredAsr = workspace.asrModels.some((model) => model.configured && model.timestamps)
  const interrupted = workspace.tasks.some((task) => task.kind === 'transcription' && ['failed', 'cancelled'].includes(task.state)) && !transcript.length
  const pause = () => { followPausedUntilRef.current = Date.now() + 2500 }

  return <div className="relative flex h-full min-h-0 flex-col bg-panel" data-audio-edit-panel="transcript">
    {search.isOpen && <div className="shrink-0 border-b border-gap px-3 py-2"><AudioEditFindReplace search={search} disabled={disabled} /></div>}
    {/* 文字稿自己的显示设置（字号、留白、波形上方字幕）就放在文字稿面板里 */}
    {!search.isOpen && <div className="absolute right-2 top-2 z-raised flex items-center gap-1">
      {corrected && <UiSwitch appearance="segmented" size="sm" aria-label="文字稿显示校对后" offLabel="原稿" onLabel="校对后" checked={textView === 'corrected'} onCheckedChange={(checked) => setTextView(checked ? 'corrected' : 'original')} />}
      <UiIconButton size="sm" tooltip="文字稿显示设置" aria-label="文字稿显示设置" onClick={workspace.openViewSettings}><SettingsIcon /></UiIconButton>
    </div>}
    <div ref={containerRef} className="min-h-0 flex-1" style={{ paddingLeft: viewSettings.sidePadding, paddingRight: viewSettings.sidePadding, fontSize: viewSettings.textSize }}
      onPointerDown={pause} onWheel={pause} onTouchMove={pause}>
      {transcript.length === 0 ? (
        <UiEmpty className="h-full" icon={<FileAudio size={UI_ICON_SIZE.hero} aria-hidden="true" />} title={interrupted ? '上次转写没有完成' : '还没有文字稿'}
          description={interrupted ? '可以接着原来的任务继续转写。' : configuredAsr ? '转写后可以像改文档一样逐词删减声音。识别按配置的模型计费。' : '先在设置里配置带时间戳的语音识别模型，再来转写。'}
          action={<UiButton variant="secondary" disabled={disabled || (!interrupted && !configuredAsr) || Boolean(workspace.sourceError)} disabledReason={!configuredAsr ? '还没有可用的语音识别模型' : '正在处理，请稍候'}
            onClick={() => void workspace.run(async () => { await transcribeAudioEdit({ projectId: project.id }); if (!interrupted) workspace.notify(notificationMessage('audioTranscribed')) })}>{interrupted ? '继续转写' : '开始转写'}</UiButton>} />
      ) : (
        <Virtuoso ref={listRef} className="h-full" data={rows} increaseViewportBy={320} components={{ Header: TranscriptEdge, Footer: TranscriptEdge }}
          itemContent={(_, row) => (
            <div className="mx-auto max-w-3xl pb-5">
              <div className="mb-1 font-mono text-xs tabular-nums text-text3">{formatTime(row[0]?.startFrame ?? 0, project.source.sampleRate)}</div>
              <p className="m-0 leading-loose">
                {row.map((block, index) => {
                  const isActive = !search.fragments.has(block.id) && activeBlockId === block.id && (mode === 'source' || block.included)
                  const previous = index > 0 ? row[index - 1] : null
                  const gap = previous ? block.startFrame - previous.endFrame : 0
                  return <Fragment key={block.id}>
                    {previous && gap >= pauseFrames ? <span aria-hidden="true" className="mx-1 inline-block rounded-control bg-raised px-1.5 align-middle font-mono text-2xs leading-5 text-text3">{(gap / project.source.sampleRate).toFixed(1)}s</span> : null}
                    <UiTextToken data-audio-word={block.id} aria-current={isActive ? 'true' : undefined} current={isActive} selected={selected.includes(block.id)} excluded={!block.included}
                      flagged={block.included && fillers.has(normalizeAudioEditFiller(block.text))} disabled={disabled}
                      onDoubleClick={() => workspace.editBlock(block.id)}
                      onContextMenu={(event) => { event.preventDefault(); workspace.setSelectedBlockIds([block.id]); workspace.deleteBlock(block.id) }}
                      onClick={(event) => {
                        if (event.shiftKey) {
                          const anchor = transcript.findIndex((item) => item.id === selected[0])
                          const target = transcript.indexOf(block)
                          workspace.setSelectedBlockIds(transcript.slice(Math.min(anchor < 0 ? target : anchor, target), Math.max(anchor, target) + 1).map((item) => item.id))
                          return
                        }
                        workspace.setSelectedBlockIds([block.id])
                        if (block.included || mode === 'source') workspace.navigateToFrame(block.startFrame)
                      }}
                      title="单击选中，双击编辑，右键删除声音">
                      {block.locked ? <Lock role="img" aria-label="已锁定" className={`${UI_ICON_SIZE_CLASS.xs} mr-0.5 inline align-baseline text-text3`} /> : null}
                      <AudioEditMatchedText block={showOriginal ? { ...block, text: originals.get(block.id) ?? block.text } : block} search={search} />
                    </UiTextToken>
                  </Fragment>
                })}
              </p>
            </div>
          )} />
      )}
    </div>
  </div>
}

/**
 * 口水音：在编辑后的声音里检测口腔咔嗒声（时间刻度上以小标记显示），一遍修完；灵敏度越高检出越多。
 * 修复可整体开关对比；重新检测会替换结果（有选区且“仅处理选区”时只替换这一段）。
 */
function AudioEditMouthClicks() {
  const workspace = useAudioEditWorkspace()
  const { project, run, notify, update, processRange: range } = workspace
  const clicks = project.mouthClicks
  const [sensitivity, setSensitivity] = useState(clicks?.sensitivity ?? 50)
  const blocked = Boolean(workspace.sourceError)
  return <AudioEditDisclosure title="口水音" value={clicks?.clicks.length ? `${clicks.clicks.length} 处` : '未检测'}>
    <p className={UI_TEXT_META_CLASS}>找出说话时口水带出的“咔啦”声，按声音前后插值修掉，不改变时长。</p>
    <UiFormRow label={<RangeLabel name="灵敏度" value={String(sensitivity)} />} density="compact"><UiRangeInput aria-label="口水音检测灵敏度" min={0} max={100} step={5} value={sensitivity} onChange={(event) => setSensitivity(Number(event.target.value))} /></UiFormRow>
    <UiButton variant="secondary" className="w-full" disabled={blocked} disabledReason="找不到原始素材" onClick={() => void run(async () => {
      const { count, perMinute } = await detectProjectAudioEditMouthClicks(project.id, sensitivity, range)
      notify(notificationMessage(count ? 'audioMouthClicksDetected' : 'audioMouthClicksNone', { count, perMinute }))
    })}>{clicks?.clicks.length ? '重新检测' : '检测口水音'}</UiButton>
    {!!clicks?.clicks.length && <>
      <UiFormRow label="修复口水音" density="compact" inline><UiSwitch aria-label="修复口水音" checked={clicks.enabled} onCheckedChange={(enabled) => update({ mouthClicks: { ...clicks, enabled } })} /></UiFormRow>
      <UiButton size="sm" className="self-start" onClick={() => update({ mouthClicks: undefined })}>清除检测结果</UiButton>
    </>}
  </AudioEditDisclosure>
}

/** 处理：一键处理、停顿与语气词参数、已处理区间、处理建议、参考逐字稿；选中文字时的删除 / 恢复 / 锁定。 */
export function AudioEditProcessPanel() {
  const workspace = useAudioEditWorkspace()
  const { project, run, notify, update, processRange: range } = workspace
  const settings = project.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS
  const enabledCuts = (project.cuts ?? []).filter((cut) => cut.enabled)
  const selectedBlocks = workspace.selectedBlocks
  const selectedIds = [...workspace.selectedBlockIds]
  const selectedSeconds = selectedBlocks.reduce((total, block) => total + Math.max(0, block.endFrame - block.startFrame), 0) / project.source.sampleRate
  const allLocked = selectedBlocks.length > 0 && selectedBlocks.every((block) => block.locked)
  const blocked = Boolean(workspace.sourceError)
  const [breathPolicy, setBreathPolicy] = useState<AudioEditBreathPolicy>('delete')
  return <PanelScroll label="处理">
    <fieldset disabled={workspace.disabled} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className={`m-0 leading-normal ${UI_TEXT_SECONDARY_CLASS}`}>去掉重念、压缩停顿、清理语气词、处理呼吸声与口水音。波形上的黄色区域是将要删除的声音，处理后仍可逐段调整。</p>
        <UiButton variant="secondary" className="w-full" disabled={blocked} disabledReason="找不到原始素材" onClick={() => void run(async () => { const result = await quickProcessAudioEdit(project.id, range); notify(notificationMessage('audioQuickProcessed', { seconds: (result.shortenedMs / 1000).toFixed(2) })) })}><Sparkles />快速处理</UiButton>
      </div>
      <UiGroup divided titleTone="compact" gap="none">
        <AudioEditDisclosure title="自定义处理参数" value={`停顿 ≥ ${settings.silenceThresholdMs} 毫秒`}>
          <UiFormRow label="仅处理选区" density="compact" inline><UiSwitch aria-label="仅处理选区" checked={workspace.selectionOnly} disabled={!selectedBlocks.length && !workspace.waveSelection} onCheckedChange={workspace.setSelectionOnly} /></UiFormRow>
          <UiFormRow label={<RangeLabel name="最短停顿" value={`${settings.silenceThresholdMs} 毫秒`} />} density="compact"><UiRangeInput aria-label="最短停顿" min={100} max={3000} step={50} value={settings.silenceThresholdMs} onChange={(event) => { const value = Number(event.target.value); update({ batchSettings: { ...settings, silenceThresholdMs: value, retainedSilenceMs: Math.min(settings.retainedSilenceMs, value - 50) } }) }} /></UiFormRow>
          <UiFormRow label={<RangeLabel name="保留时长" value={`${settings.retainedSilenceMs} 毫秒`} />} density="compact"><UiRangeInput aria-label="保留时长" min={0} max={settings.silenceThresholdMs - 50} step={50} value={settings.retainedSilenceMs} onChange={(event) => update({ batchSettings: { ...settings, retainedSilenceMs: Number(event.target.value) } })} /></UiFormRow>
          <UiFormRow label={<RangeLabel name="静音阈值" value={`${settings.noiseDb} dB`} />} density="compact"><UiRangeInput aria-label="静音阈值" min={-80} max={-10} step={1} value={settings.noiseDb} onChange={(event) => update({ batchSettings: { ...settings, noiseDb: Number(event.target.value) } })} /></UiFormRow>
          <UiFormRow label="包括片头片尾" density="compact" inline><UiSwitch aria-label="包括片头片尾" checked={settings.trimEdges} onCheckedChange={(value) => update({ batchSettings: { ...settings, trimEdges: value } })} /></UiFormRow>
          <UiButton variant="secondary" className="w-full" disabled={blocked} disabledReason="找不到原始素材" onClick={() => void run(async () => { const result = await compressAudioEditSilence(project.id, range); notify(notificationMessage('audioSilenceCompressed', { count: result.count, seconds: (result.shortenedMs / 1000).toFixed(2) })) })}>压缩停顿</UiButton>
          <p className={UI_TEXT_META_CLASS}>选择需要清理的词类；可能有语义的词默认保留。</p>
          <div role="group" aria-label="语气词" className="flex flex-wrap gap-1">{['嗯', '呃', '额', '那个', '就是', '啊'].map((word) => <UiChipButton key={word} size="sm" active={settings.fillers.includes(word)} aria-pressed={settings.fillers.includes(word)} onClick={() => update({ batchSettings: { ...settings, fillers: settings.fillers.includes(word) ? settings.fillers.filter((value) => value !== word) : [...settings.fillers, word] } })}>{word}</UiChipButton>)}</div>
          <UiButton variant="secondary" className="w-full" onClick={() => void run(async () => notify(notificationMessage('audioFillersCleaned', { count: await cleanProjectAudioEditFillers(project.id, range) })))}>清理语气词</UiButton>
          <p className={UI_TEXT_META_CLASS}>呼吸声：删除时去掉呼吸，并把字与字之间残留的气声清成静音、只留短气口；和字连着的只减弱。第一次使用会下载约 13 MB 的本地模型。</p>
          <UiSegmented ariaLabel="呼吸声" size="sm" fullWidth value={breathPolicy} onChange={setBreathPolicy}
            options={[{ value: 'delete', label: '删除' }, { value: 'attenuate', label: '减弱' }, { value: 'mute', label: '静音' }, { value: 'keep', label: '保留' }]} />
          <UiButton variant="secondary" className="w-full" disabled={blocked} disabledReason="找不到原始素材" onClick={() => void run(async () => { const { counts } = await processProjectAudioEditBreaths(project.id, breathPolicy, range); notify(notificationMessage('audioBreathsProcessed', counts)) })}>处理呼吸声</UiButton>
        </AudioEditDisclosure>
        <AudioEditMouthClicks />
        {enabledCuts.length > 0 && <AudioEditDisclosure title="已处理区间" value={`${enabledCuts.length} 处`}>
          <div className="flex flex-col">{enabledCuts.map((cut) => <div key={cut.id} className="flex items-center justify-between gap-2">
            <UiButton size="sm" className="font-mono tabular-nums" onClick={() => workspace.seek(Math.max(0, cut.startFrame - project.source.sampleRate))}>{formatTime(cut.startFrame, project.source.sampleRate)} · {cut.mode === 'mute' ? '静音' : '删除'}</UiButton>
            <UiButton size="sm" onClick={() => update({ cuts: project.cuts?.map((item) => item.id === cut.id ? { ...item, enabled: false } : item) })}>恢复</UiButton>
          </div>)}</div>
        </AudioEditDisclosure>}
        <AudioEditSuggestions project={project} onSeek={workspace.navigateToFrame} onResolve={workspace.resolveSuggestions} />
        <AudioEditDisclosure title="参考逐字稿" value={project.referenceScript?.trim() ? '已填写' : '未使用'}>
          <UiTextArea rows={4} placeholder="用于对齐内容，不替代真实识别文本" value={project.referenceScript} onChange={(event) => workspace.setReferenceScript(event.target.value)} />
          <UiButton className="self-start" onClick={() => void run(async () => { const value = await openDialog({ multiple: false, filters: [{ name: '文本', extensions: ['txt', 'md'] }] }); const path = Array.isArray(value) ? value[0] : value; if (path) workspace.setReferenceScript(await readTextFile(path)) })}>导入参考稿</UiButton>
        </AudioEditDisclosure>
      </UiGroup>
      {selectedBlocks.length > 0 && <UiGroup divided titleTone="compact" title={`已选 ${selectedBlocks.length} 个词 · ${selectedSeconds.toFixed(1)} 秒`}>
        <div className="-mx-2 flex flex-wrap gap-0.5">
          <UiButton size="sm" variant="danger" onClick={() => workspace.setBlocksIncluded(selectedIds, false)}><Trash2 className="mr-1" />删除声音</UiButton>
          <UiButton size="sm" onClick={() => workspace.setBlocksIncluded(selectedIds, true)}><RotateCcw className="mr-1" />恢复</UiButton>
          <UiButton size="sm" onClick={() => update({ transcript: project.transcript.map((block) => selectedIds.includes(block.id) ? { ...block, locked: !allLocked } : block) })}>{allLocked ? <LockOpen className="mr-1" /> : <Lock className="mr-1" />}{allLocked ? '解锁' : '锁定'}</UiButton>
        </div>
      </UiGroup>}
    </fieldset>
  </PanelScroll>
}

/** 效果组：见 AudioEditEffectRack（Audition 式效果槽，实时试听）。 */
export { AudioEditEffectRack as AudioEditEffectsPanel } from './AudioEditEffectRack'

/** 基本声音：按声音类型一键处理（修复、透明度、创意、响度），换算成效果链排在效果组前面。 */
export function AudioEditEssentialSoundPanel() {
  const workspace = useAudioEditWorkspace()
  const { project, update } = workspace
  const [matching, setMatching] = useState(false)
  const [measured, setMeasured] = useState<{ projectId: string; lufs: number } | null>(null)
  const match = (targetLufs: number) => void workspace.run(async () => {
    setMatching(true)
    try { setMeasured({ projectId: project.id, lufs: (await matchProjectAudioEditLoudness(project.id, targetLufs)).integratedLufs }) } finally { setMatching(false) }
  })
  return <PanelScroll label="基本声音">
    <EssentialSoundControls value={project.essentialSound} disabled={workspace.disabled} offline={AUDIO_EDIT_OFFLINE_REPAIR}
      onChange={essentialSound => update({ essentialSound })} gesture={() => beginAudioEditGesture(project.id)}
      onMatchLoudness={match} matching={matching} {...(measured?.projectId === project.id ? { measuredLufs: measured.lufs } : {})} />
  </PanelScroll>
}

/** 交付：导出格式与附带内容（导出按钮在命令带）。面板最窄约 220px，导出格式的触发器只写格式名，用途写在菜单选项里。 */
export function AudioEditDeliveryPanel() {
  const workspace = useAudioEditWorkspace()
  const { project, update, deliveryFormat: format } = workspace
  const plugins = workspace.processors.filter((item) => item.available && item.semanticRole)
  return <PanelScroll label="交付">
    <UiGroup titleTone="compact" labelWidth={96}>
      <UiFormRow label="导出格式" density="compact">
        <Dropdown<'xml' | 'wav'> ariaLabel="导出格式" size="sm" className="w-full" minWidthStrategy="none" value={format} display={format === 'xml' ? 'XML' : 'WAV'}
          options={[{ label: 'XML · 继续剪辑', value: 'xml' }, { label: 'WAV · 剪后音频', value: 'wav' }]} onSelect={workspace.setDeliveryFormat} />
      </UiFormRow>
      {project.source.mediaType === 'audio' && format === 'xml' && <UiFormRow label="XML 帧率" density="compact">
        <Dropdown<number> ariaLabel="XML 帧率" size="sm" className="w-full" minWidthStrategy="none" value={project.xmlFrameRate?.numerator ?? 25} display={`${project.xmlFrameRate?.numerator ?? 25} fps`}
          options={[24, 25, 30, 50, 60].map((fps) => ({ label: `${fps} fps`, value: fps }))} onSelect={(fps) => update({ xmlFrameRate: { numerator: fps, denominator: 1 } })} />
      </UiFormRow>}
      <UiFormRow label="附带 SRT 字幕" density="compact" inline><UiSwitch aria-label="附带 SRT 字幕" checked={workspace.withSrt} onCheckedChange={workspace.setWithSrt} /></UiFormRow>
      {plugins.length > 0 && <UiFormRow label="包含 VST3 插件" info="基本声音、效果组、修复与口水音总会算进导出；这一项只管 VST3 插件的处理。" density="compact" inline><UiSwitch aria-label="包含 VST3 插件" checked={workspace.withProcessing} onCheckedChange={workspace.setWithProcessing} /></UiFormRow>}
      <p className={UI_TEXT_META_CLASS}>{format === 'xml' ? '有声音处理时同时保存全长处理音轨，XML 引用该音轨；否则直接引用原文件。切点按视频帧向外对齐。' : '导出剪好的声音，基本声音与效果组都已算进去。'}</p>
    </UiGroup>
  </PanelScroll>
}

/** 历史记录：每一步改了什么；点击回到那一步（人和助手的修改在同一个撤销栈里）。 */
export function AudioEditHistoryPanel() {
  const workspace = useAudioEditWorkspace()
  const { past, future, undo, redo } = workspace.history
  const entries = useMemo(() => audioEditHistoryEntries(past, workspace.project, future), [past, workspace.project, future])
  const jump = (steps: number) => {
    for (let index = 0; index < Math.abs(steps); index += 1) (steps > 0 ? undo : redo)()
  }
  return <PanelScroll label="历史记录">
    {entries.length <= 1
      ? <UiEmpty size="node" icon={<History className="h-6 w-6" />} title="还没有修改" description="每次编辑都会出现在这里，点一下就能回到那一步。" />
      : <div role="list" className="flex flex-col gap-0.5">
        {entries.map((entry, index) => <UiOptionButton key={index} role="listitem" variant="menu" size="sm" active={entry.state === 'current'} disabled={workspace.disabled}
          onClick={() => jump(entry.steps)} aria-current={entry.state === 'current' ? 'step' : undefined}>
          <span className={entry.state === 'undone' ? 'text-text3' : ''}>{entry.label}</span>
        </UiOptionButton>)}
      </div>}
  </PanelScroll>
}
