import { Sparkles } from 'lucide-react'
import { PanelTrigger, UiButton, UiChipButton, UiFormRow, UiGroup, UiRangeInput, UiSwitch, UiTextArea, UI_TEXT_META_CLASS, UI_TEXT_SECONDARY_CLASS } from '@/components/ui'
import { UI_PANEL_BODY_HEIGHT_CLASS } from '@/components/ui/styleTokens'
import { DEFAULT_AUDIO_EDIT_SETTINGS } from '@/core/audioEdit/edits'
import { notificationMessage } from '@/i18n/notifications'
import { openDialog, readTextFile } from '@/platform/desktopApi'
import { AudioEditDisclosure } from '../AudioEditDisclosure'
import { AudioEditSuggestions } from '../AudioEditSuggestions'
import { cleanProjectAudioEditFillers, compressAudioEditSilence, processProjectAudioEditBreaths, quickProcessAudioEdit } from '../application/audioEditApplicationService'
import { useAudioEditWorkspace } from './audioEditWorkspaceContext'

function formatTime(frames: number, sampleRate: number): string {
  const seconds = Math.max(0, frames / Math.max(1, sampleRate))
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

/** 滑杆行标签：名称 + 当前读数（读数用等宽数字，拖动时不跳宽）。 */
function RangeLabel({ name, value }: { name: string; value: string }): JSX.Element {
  return <span className="flex items-baseline justify-between gap-2"><span>{name}</span><span className="tabular-nums text-text3">{value}</span></span>
}

/**
 * 自动粗剪（文字稿标签行上的工具）：改时长的剪辑都在这里——去重念、压缩停顿、清理语气词、删除呼吸声，
 * 以及已处理区间、剪辑线索与参考逐字稿。改声音不改时长的处理（去除口水音、呼吸声减弱等）在效果控件里。
 */
export function AudioEditRoughCutMenu(): React.ReactElement {
  const workspace = useAudioEditWorkspace()
  return <PanelTrigger panelSize="compact" panelPadding="menu" alignment="bottomRight" renderPanel={() => <RoughCutPanel />}>
    {({ open, togglePanel }) => <UiButton size="sm" aria-expanded={open} disabled={workspace.disabled} disabledReason="正在处理，请稍候" onClick={togglePanel}><Sparkles />自动粗剪</UiButton>}
  </PanelTrigger>
}

function RoughCutPanel(): React.ReactElement {
  const workspace = useAudioEditWorkspace()
  const { project, run, notify, update, processRange: range } = workspace
  const settings = project.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS
  const enabledCuts = (project.cuts ?? []).filter((cut) => cut.enabled)
  const blocked = Boolean(workspace.sourceError)
  return <div className={`flex w-80 flex-col overflow-y-auto overscroll-contain p-2 ${UI_PANEL_BODY_HEIGHT_CLASS.content}`} aria-label="自动粗剪">
    <fieldset disabled={workspace.disabled} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <div className="flex flex-col gap-2">
        <p className={`m-0 leading-normal ${UI_TEXT_SECONDARY_CLASS}`}>去掉重念、压缩停顿、清理语气词，一次做完；波形上的黄色区域是将要删除的声音，处理后仍可逐段调整。</p>
        <UiButton variant="secondary" className="w-full" disabled={blocked} disabledReason="找不到原始素材" onClick={() => void run(async () => { const result = await quickProcessAudioEdit(project.id, range); notify(notificationMessage('audioQuickProcessed', { seconds: (result.shortenedMs / 1000).toFixed(2) })) })}><Sparkles />快速处理</UiButton>
        <UiFormRow label="仅处理选区" density="compact" inline><UiSwitch aria-label="仅处理选区" checked={workspace.selectionOnly} disabled={!workspace.selectedBlocks.length && !workspace.waveSelection} onCheckedChange={workspace.setSelectionOnly} /></UiFormRow>
      </div>
      <UiGroup divided titleTone="compact" gap="none">
        <AudioEditDisclosure title="停顿" value={`≥ ${settings.silenceThresholdMs} 毫秒`}>
          <UiFormRow label={<RangeLabel name="最短停顿" value={`${settings.silenceThresholdMs} 毫秒`} />} density="compact"><UiRangeInput aria-label="最短停顿" min={100} max={3000} step={50} value={settings.silenceThresholdMs} onChange={(event) => { const value = Number(event.target.value); update({ batchSettings: { ...settings, silenceThresholdMs: value, retainedSilenceMs: Math.min(settings.retainedSilenceMs, value - 50) } }) }} /></UiFormRow>
          <UiFormRow label={<RangeLabel name="保留时长" value={`${settings.retainedSilenceMs} 毫秒`} />} density="compact"><UiRangeInput aria-label="保留时长" min={0} max={settings.silenceThresholdMs - 50} step={50} value={settings.retainedSilenceMs} onChange={(event) => update({ batchSettings: { ...settings, retainedSilenceMs: Number(event.target.value) } })} /></UiFormRow>
          <UiFormRow label={<RangeLabel name="静音阈值" value={`${settings.noiseDb} dB`} />} density="compact"><UiRangeInput aria-label="静音阈值" min={-80} max={-10} step={1} value={settings.noiseDb} onChange={(event) => update({ batchSettings: { ...settings, noiseDb: Number(event.target.value) } })} /></UiFormRow>
          <UiFormRow label="包括片头片尾" density="compact" inline><UiSwitch aria-label="包括片头片尾" checked={settings.trimEdges} onCheckedChange={(value) => update({ batchSettings: { ...settings, trimEdges: value } })} /></UiFormRow>
          <UiButton variant="secondary" className="w-full" disabled={blocked} disabledReason="找不到原始素材" onClick={() => void run(async () => { const result = await compressAudioEditSilence(project.id, range); notify(notificationMessage('audioSilenceCompressed', { count: result.count, seconds: (result.shortenedMs / 1000).toFixed(2) })) })}>压缩停顿</UiButton>
        </AudioEditDisclosure>
        <AudioEditDisclosure title="语气词" value={`${settings.fillers.length} 类`}>
          <p className={UI_TEXT_META_CLASS}>选择需要清理的词类；可能有语义的词默认保留。</p>
          <div role="group" aria-label="语气词" className="flex flex-wrap gap-1">{['嗯', '呃', '额', '那个', '就是', '啊'].map((word) => <UiChipButton key={word} size="sm" active={settings.fillers.includes(word)} aria-pressed={settings.fillers.includes(word)} onClick={() => update({ batchSettings: { ...settings, fillers: settings.fillers.includes(word) ? settings.fillers.filter((value) => value !== word) : [...settings.fillers, word] } })}>{word}</UiChipButton>)}</div>
          <UiButton variant="secondary" className="w-full" onClick={() => void run(async () => notify(notificationMessage('audioFillersCleaned', { count: await cleanProjectAudioEditFillers(project.id, range) })))}>清理语气词</UiButton>
        </AudioEditDisclosure>
        <AudioEditDisclosure title="呼吸声" value="删除">
          <p className={UI_TEXT_META_CLASS}>删掉呼吸（缩短时长），并把字与字之间残留的气声清成静音、只留短气口；和字连着的只减弱。只想压低呼吸、不改时长，用效果控件里的“呼吸声”。第一次使用会下载约 13 MB 的本地模型。</p>
          <UiButton variant="secondary" className="w-full" disabled={blocked} disabledReason="找不到原始素材" onClick={() => void run(async () => { const { counts } = await processProjectAudioEditBreaths(project.id, 'delete', range); notify(notificationMessage('audioBreathsProcessed', counts)) })}>删除呼吸声</UiButton>
        </AudioEditDisclosure>
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
    </fieldset>
  </div>
}
