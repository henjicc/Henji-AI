import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { FileAudio, History, Lock, LockOpen, RotateCcw, Trash2 } from 'lucide-react'
import {
  Dropdown, UiButton, UiEmpty, UiFormRow, UiGroup, UiIconButton, UiOptionButton, UiSwitch, UiTextToken, UiToolbar,
  UI_TEXT_META_CLASS,
} from '@/components/ui'
import { DockHeaderPortal } from '@/components/dockLayouts/DockHeaderPortal'
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { ICON_SETTINGS as SettingsIcon, UI_ICON_SIZE } from '@/core/theme/icons'
import { buildAudioEditCaptionGroups } from '@/core/audioEdit/captions'
import { normalizeAudioEditFiller } from '@/core/audioEdit/analysis'
import { DEFAULT_AUDIO_EDIT_SETTINGS, DEFAULT_AUDIO_EDIT_VIEW_SETTINGS } from '@/core/audioEdit/edits'
import { notificationMessage } from '@/i18n/notifications'
import { AudioEditFindReplace, AudioEditMatchedText } from '../AudioEditTextTools'
import { transcribeAudioEdit } from '../application/audioEditApplicationService'
import { AudioEditRoughCutMenu } from './AudioEditRoughCut'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'
import { audioEditHistoryEntries } from './audioEditHistory'
import { useAudioEditWorkspace } from './audioEditWorkspaceContext'

function formatTime(frames: number, sampleRate: number): string {
  const seconds = Math.max(0, frames / Math.max(1, sampleRate))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

/** 停靠面板的滚动内容区：统一内边距，面板之间读起来是同一套排版。 */
function PanelScroll({ children, label }: { children: React.ReactNode; label: string }) {
  return <section aria-label={label} className="h-full min-h-0 overflow-y-auto bg-panel p-3">{children}</section>
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
    {/* 文字稿自己的工具（自动粗剪、原稿 / 校对后、显示设置）放在它的标签行；面板组太窄时回到面板顶部一行 */}
    <DockHeaderPortal panelId="audio_edit:transcript" fallback={children => <div className="flex shrink-0 justify-end gap-1 px-2 pt-1">{children}</div>}>
      <div className="flex items-center gap-1">
        {transcript.length > 0 && <AudioEditRoughCutMenu />}
        {corrected && <UiSwitch appearance="segmented" size="sm" aria-label="文字稿显示校对后" offLabel="原稿" onLabel="校对后" checked={textView === 'corrected'} onCheckedChange={(checked) => setTextView(checked ? 'corrected' : 'original')} />}
        <UiIconButton size="sm" tooltip="文字稿显示设置" aria-label="文字稿显示设置" onClick={workspace.openViewSettings}><SettingsIcon /></UiIconButton>
      </div>
    </DockHeaderPortal>
    {search.isOpen && <div className="shrink-0 border-b border-gap px-3 py-2"><AudioEditFindReplace search={search} disabled={disabled} /></div>}
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
    <TranscriptSelectionBar />
  </div>
}

/** 文字稿底栏：选中词时显示数量与时长，以及删除声音 / 恢复 / 锁定（原来在“处理”面板里）。 */
function TranscriptSelectionBar(): React.ReactElement | null {
  const workspace = useAudioEditWorkspace()
  const { project, update } = workspace
  const selectedBlocks = workspace.selectedBlocks
  if (!selectedBlocks.length) return null
  const selectedIds = [...workspace.selectedBlockIds]
  const seconds = selectedBlocks.reduce((total, block) => total + Math.max(0, block.endFrame - block.startFrame), 0) / project.source.sampleRate
  const allLocked = selectedBlocks.every((block) => block.locked)
  return <UiToolbar variant="footer" aria-label="所选文字" trailing={<>
    <UiButton size="sm" variant="danger" disabled={workspace.disabled} onClick={() => workspace.setBlocksIncluded(selectedIds, false)}><Trash2 />删除声音</UiButton>
    <UiButton size="sm" disabled={workspace.disabled} onClick={() => workspace.setBlocksIncluded(selectedIds, true)}><RotateCcw />恢复</UiButton>
    <UiButton size="sm" disabled={workspace.disabled} onClick={() => update({ transcript: project.transcript.map((block) => selectedIds.includes(block.id) ? { ...block, locked: !allLocked } : block) })}>{allLocked ? <LockOpen /> : <Lock />}{allLocked ? '解锁' : '锁定'}</UiButton>
  </>}>{`已选 ${selectedBlocks.length} 个词 · ${seconds.toFixed(1)} 秒`}</UiToolbar>
}

/** 交付：导出格式与附带内容（导出按钮在命令带）。面板最窄约 220px，导出格式的触发器只写格式名，用途写在菜单选项里。 */
export function AudioEditDeliveryPanel() {
  const workspace = useAudioEditWorkspace()
  const { project, update, deliveryFormat: format } = workspace
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
      <p className={UI_TEXT_META_CLASS}>{format === 'xml' ? '有声音处理时同时保存全长处理音轨，XML 引用该音轨；否则直接引用原文件。切点按视频帧向外对齐。' : '导出剪好的声音，效果控件里的效果与输出都已算进去。'}</p>
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
