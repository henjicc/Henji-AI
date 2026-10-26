import React from 'react'
import { useStore } from 'zustand'
import { getAudioCaptureSession } from '@/features/audioCapture'
import { AudioCapturePreview } from './AudioCapturePreview'
import { Brush, Hand, Magnet, MoveLeft, MoveRight, RotateCcw, SquareDashed, TextCursor, Trash2, Volume1, VolumeX, Wand2 } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { PanelTrigger, UiButton, UiFormRow, UiIconButton, UiRangeInput, UiSegmented, UiTextToken } from '@/components/ui'
import { useContextMenu } from '@/hooks/useContextMenu'
import { DockHeaderPortal } from '@/components/dockLayouts/DockHeaderPortal'
import NumberInput from '@/components/ui/NumberInput'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import type { AudioEditRange } from '@/core/audioEdit/types'
import { buildAudioEditCaptionGroups } from '@/core/audioEdit/captions'
import { buildProjectAudioEditTimeline } from '@/core/audioEdit/timeline'
import { DEFAULT_AUDIO_EDIT_SETTINGS } from '@/core/audioEdit/edits'
import { audioEditSpeechEdges } from '@/core/audioEdit/gaps'
import { audioEditSourceEdited, audioEditSourceRecipe } from '@/core/audioEdit/regions'
import { useWaveformData, type WaveformState } from '@/hooks/useWaveformData'
import { getPlatform } from '@/platform/runtime'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'
import { AudioEditMatchedText } from '../AudioEditTextTools'
import type { WaveformViewport } from '../waveformViewport'
import { AudioEditTransport } from '../workspace/AudioEditTransport'
import { useAudioEditWorkspace } from '../workspace/audioEditWorkspaceContext'
import { AudioSpectralEditor, type AudioPlayheadSource } from './AudioSpectralEditor'
import { useAudioEditEffectSelection } from '../workspace/audioEditEffectInsert'
import { setAudioEditMouthClicksSkipped } from '@/core/audioEdit/effects'
import type { AudioEditorTool } from './spectralEditorModel'
import { audioWaveToolForKey, type audioWaveActions, type AudioWaveEditorState } from './audioWaveEditorState'
import { useAudioEditSpectral } from './useAudioEditSpectral'
import { audioEditSpectralClient, getAudioEditEditedSource } from '../application/audioEditRegions'
import { audioEditScrub } from '../preview/audioEditScrub'
import { spliceAudioRanges } from '@/core/audioEdit/splice'

const TOOLS: Array<{ id: AudioEditorTool; label: string; icon: React.ReactNode }> = [
  { id: 'time', label: '时间选区 · V', icon: <TextCursor /> },
  { id: 'marquee', label: '框选频谱 · E', icon: <SquareDashed /> },
  { id: 'brush', label: '修复画笔 · B', icon: <Brush /> },
  { id: 'hand', label: '平移 · H', icon: <Hand /> },
]
/** 从属参数带：工具（模式）在左，显示方式与画笔大小随后；选区动作只在有选区时出现。 */
export function AudioWaveToolbar({ editor, selection, disabled, actions, onEditSelection }: {
  editor: AudioWaveEditorState
  selection: AudioEditRange | null
  disabled: boolean
  actions: ReturnType<typeof audioWaveActions>
  onEditSelection: (mode: 'delete' | 'mute' | 'restore') => void
}) {
  const [gainDb, setGainDb] = React.useState(-6)
  const [gainOpen, setGainOpen] = React.useState(false)
  return <div className="flex min-w-0 items-center gap-1.5" data-audio-wave-toolbar>
    <div role="group" aria-label="编辑工具" className="flex items-center gap-0.5">
      {TOOLS.map(tool => <UiIconButton key={tool.id} size="sm" selection="mode" on={editor.tool === tool.id} aria-pressed={editor.tool === tool.id} aria-label={tool.label} disabled={disabled && tool.id !== 'hand'} disabledReason="请先录入音频或暂停录音" tooltip={tool.label} onClick={() => editor.setTool(tool.id)}>{tool.icon}</UiIconButton>)}
    </div>
    <UiSegmented ariaLabel="显示" size="sm" value={editor.display} onChange={editor.setDisplay}
      options={[{ value: 'both', label: '都显示' }, { value: 'waveform', label: '波形' }, { value: 'spectrum', label: '频谱' }]} />
    <UiIconButton size="sm" on={editor.snapToSpeech} aria-pressed={editor.snapToSpeech} aria-label="吸附" tooltip="吸附：拖删除、静音区间的边缘时，吸到字声音真正开始、结束的位置和相邻区间的边缘；关着时随意拖" onClick={() => editor.setSnapToSpeech(!editor.snapToSpeech)}><Magnet /></UiIconButton>
    {editor.tool === 'brush' && <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-text2">
      画笔
      <UiRangeInput className="!w-24 shrink-0" aria-label="画笔大小" min={4} max={48} step={1} value={editor.brushPixels} onChange={event => editor.setBrushPixels(Number(event.target.value))} />
    </label>}
    {/* 选区操作在面板标签行里，用图标按钮（说明在悬停提示里），窄布局也放得下；整组同档。 */}
    {(editor.spectralSelection || selection) && <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-line" />}
    <div role="group" aria-label="选区操作" className="flex min-w-0 items-center gap-0.5">
      {editor.spectralSelection && <UiIconButton size="sm" aria-label="修复框选区域" disabled={disabled} disabledReason="正在处理，请稍候" tooltip="修复框选区域：用周围的声音补上，去掉其中的杂音" onClick={() => { actions.healArea(editor.spectralSelection!); editor.setSpectralSelection(null) }}><Wand2 /></UiIconButton>}
      {selection && <>
        <UiIconButton size="sm" tone="danger" aria-label="删除选区" disabled={disabled} disabledReason="正在处理，请稍候" tooltip="删除选区 · Delete" onClick={() => onEditSelection('delete')}><Trash2 /></UiIconButton>
        <UiIconButton size="sm" aria-label="静音选区" disabled={disabled} disabledReason="正在处理，请稍候" tooltip="静音选区 · M" onClick={() => onEditSelection('mute')}><VolumeX /></UiIconButton>
        <PanelTrigger panelSize="compact" panelPadding="content" open={gainOpen} onOpenChange={setGainOpen} renderPanel={() => <div className="flex w-56 flex-col gap-3">
          <UiFormRow label="音量（dB）" density="compact"><NumberInput ariaLabel="音量变化（dB）" value={gainDb} min={-60} max={24} step={0.5} precision={1} onChange={setGainDb} /></UiFormRow>
          <UiButton variant="secondary" disabled={disabled} disabledReason="正在处理，请稍候" onClick={() => { actions.gain(selection, gainDb); setGainOpen(false) }}>应用到选区</UiButton>
        </div>}>
          {({ open, togglePanel }) => <UiIconButton size="sm" aria-label="调整选区音量" disabled={disabled} disabledReason="正在处理，请稍候" tooltip={open ? undefined : '调整选区音量'} aria-expanded={open} on={open} onClick={togglePanel} data-panel-trigger-button><Volume1 /></UiIconButton>}
        </PanelTrigger>
        <UiIconButton size="sm" aria-label="淡入" disabled={disabled} disabledReason="正在处理，请稍候" tooltip="淡入：选区内从无声渐强到原音量" onClick={() => actions.fadeIn(selection)}><MoveRight /></UiIconButton>
        <UiIconButton size="sm" aria-label="淡出" disabled={disabled} disabledReason="正在处理，请稍候" tooltip="淡出：选区内从原音量渐弱到无声" onClick={() => actions.fadeOut(selection)}><MoveLeft /></UiIconButton>
        {actions.canDeclick(selection) && <UiIconButton size="sm" aria-label="去爆音" disabled={disabled} disabledReason="正在处理，请稍候" tooltip="去爆音：用前后的声音补上这一小段，去掉爆音、咔嗒声" onClick={() => actions.declick(selection)}><Wand2 /></UiIconButton>}
        <UiIconButton size="sm" aria-label="恢复选区" disabled={disabled} disabledReason="正在处理，请稍候" tooltip="恢复选区：撤掉选区内的删除和静音" onClick={() => onEditSelection('restore')}><RotateCcw /></UiIconButton>
      </>}
    </div>
  </div>
}

/** 刻度下方的字幕条：只排可见区间里的字幕，单击选中、双击改字、右键删除声音（与文字稿同一套操作）。 */
function CaptionLane({ view }: { view: WaveformViewport }) {
  const workspace = useAudioEditWorkspace()
  const { project } = workspace
  const rate = project.source.sampleRate
  const groups = React.useMemo(() => project.transcript.some(block => block.captionBreakAfter !== undefined)
    ? buildAudioEditCaptionGroups(project.transcript, rate)
    : project.transcript.map(block => ({ id: block.id, startFrame: block.startFrame, endFrame: block.endFrame, blocks: [block] })), [project.transcript, rate])
  const length = Math.max(1, view.end - view.start)
  const position = (frame: number) => (frame - view.start) / length * 100
  return <div className="absolute inset-x-0 inset-y-0.5" data-audio-captions>
    {groups.filter(group => group.endFrame > view.start && group.startFrame < view.end).slice(0, 400).map(group => <div key={group.id} data-ui-timeline-item className="absolute flex h-6 gap-0.5 overflow-hidden whitespace-nowrap pr-0.5"
      style={{ left: `${position(Math.max(view.start, group.startFrame))}%`, width: `${(Math.min(view.end, group.endFrame) - Math.max(view.start, group.startFrame)) / length * 100}%` }}>
      {group.blocks.map(block => <UiTextToken appearance="chip" key={block.id} disabled={workspace.disabled} selected={workspace.selectedBlockIds.includes(block.id)} excluded={!block.included}
        title={`${block.text} · 单击选中，双击编辑，右键删除`}
        onClick={() => { workspace.setSelectedBlockIds([block.id]); workspace.navigateToFrame(block.startFrame) }} onDoubleClick={() => workspace.editBlock(block.id)}
        onContextMenu={(event) => { event.preventDefault(); workspace.setSelectedBlockIds([block.id]); workspace.deleteBlock(block.id) }}>
        <span className="block w-full truncate">{block.text ? <AudioEditMatchedText block={block} search={workspace.textSearch} /> : '（空字幕）'}</span>
      </UiTextToken>)}
    </div>)}
  </div>
}

/** 播放位置的订阅源（模块级，跨面板共用）：编辑区直接改播放头位置，不经过 React 渲染。 */
const playheadSource: AudioPlayheadSource = {
  current: () => useAudioEditPlaybackStore.getState().sourceFrame,
  subscribe: (listener) => useAudioEditPlaybackStore.subscribe((state, previous) => { if (state.sourceFrame !== previous.sourceFrame) listener(state.sourceFrame) }),
}

/**
 * 各作品最近一次读出的“已编辑”音频：声音没变时重新打开直接沿用（它的波形还在内存里），
 * 不先闪一下原素材的波形再跳成处理后的。仍会照常向主进程确认一次。
 */
const lastEditedSources = new Map<string, { soundKey: string; path: string }>()
function rememberEditedSource(projectId: string, soundKey: string, path: string): void {
  lastEditedSources.delete(projectId)
  lastEditedSources.set(projectId, { soundKey, path })
  for (const key of lastEditedSources.keys()) { if (lastEditedSources.size <= 8) break; lastEditedSources.delete(key) }
}

/** 编辑器面板：导航条、刻度、波形与频谱，底部是走带。 */
export function AudioWaveWorkspace() {
  const workspace = useAudioEditWorkspace()
  const { project, wave: editor, waveSelection: selection, setWaveSelection: onSelection, seek: onSeek, editSelection: onEditSelection, waveActions: actions, disabled } = workspace
  const { durationFrames: duration, sampleRate: rate } = project.source
  const capture = getAudioCaptureSession()
  const recording = useStore(capture.store, state => state.phase === 'recording' && state.placement?.projectId === project.id)
  const [liveDuration, setLiveDuration] = React.useState(duration)
  const [liveFrames, setLiveFrames] = React.useState(0)
  const { view: captureView, setView: setCaptureView } = editor
  React.useEffect(() => {
    if (!recording) { setLiveDuration(duration); setLiveFrames(0); return }
    const update = (): void => {
      const placement = capture.store.getState().placement
      if (!placement) return
      const frames = Math.ceil(capture.durationSeconds * rate)
      const current = placement.startFrame + frames
      const length = Math.max(rate * 10, captureView.end - captureView.start)
      setLiveFrames(frames)
      setLiveDuration(Math.max(duration + (placement.startFrame === placement.endFrame ? frames : 0), current + rate * 2))
      if (current >= captureView.end) setCaptureView({ start: Math.max(0, current - length * .8), end: current + length * .2 })
    }
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [capture, recording, duration, rate, captureView, setCaptureView])
  const autoGain = useAudioEditPlaybackStore(state => state.autoGain && state.mode !== 'delivery')
  // 声音内容：只有修复、效果链里整段处理的那一段、区间音量真正变了才算。删除、静音不改声音；呼吸、气口转成手动剪辑只换 id，也不算。
  // 效果链末尾边播边算的实时效果不改波形（波形显示进这些效果之前的声音）。
  const recipe = React.useMemo(() => audioEditSourceRecipe(project), [project.repairs, project.gainRegions, project.effectChain, project.chainBypassed]) // eslint-disable-line react-hooks/exhaustive-deps
  const edited = audioEditSourceEdited(recipe)
  const soundKey = React.useMemo(() => JSON.stringify(recipe), [recipe])
  // 有修复或区间音量时，波形改读“已编辑、未删除”的音频（时间轴同原素材），删除与静音仍用叠加标记表示。
  // 声音变了才重新生成；新的出来之前继续显示上一份，不先退回原素材再跳回来。
  const [editedPath, setEditedPath] = React.useState<string | null>(() => {
    const last = lastEditedSources.get(project.id)
    return edited && last?.soundKey === soundKey ? last.path : null
  })
  React.useEffect(() => {
    if (!edited) { setEditedPath(null); return }
    let cancelled = false
    // 先保存再问主进程：主进程按文件里的作品处理，没保存就会拿回上一份声音，还被记在这次的声音名下。
    const timer = window.setTimeout(() => void getAudioEditEditedSource(project.id).then(result => {
      if (cancelled) return
      setEditedPath(result.audioPath)
      rememberEditedSource(project.id, soundKey, result.audioPath)
    }, () => undefined), 150)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [edited, project.id, project.source.audioPath, soundKey])
  const channels: 1 | 2 = project.source.channels > 1 ? 2 : 1
  const waveformSource = duration ? editedPath ?? project.source.audioPath : null
  const loadedWaveform = useWaveformData(waveformSource ? { source: waveformSource, channels } : null, 'full')
  // 换成另一份音频（声音改过后重新生成）时，新波形读出来之前沿用同一工程上一份已读出的波形，不闪“正在读取”。
  const shownWaveform = React.useRef<{ projectId: string; state: WaveformState } | null>(null)
  if (loadedWaveform.data) shownWaveform.current = { projectId: project.id, state: loadedWaveform }
  const held = shownWaveform.current?.projectId === project.id && waveformSource ? shownWaveform.current.state : null
  const waveform = loadedWaveform.data || loadedWaveform.status === 'error' || !held ? loadedWaveform : held
  const [columns, setColumns] = React.useState(0)
  const host = React.useRef<HTMLDivElement | null>(null)
  React.useLayoutEffect(() => {
    const element = host.current
    if (!element || typeof ResizeObserver === 'undefined') return
    // 尺寸停下来再换算列数：拖动面板或开关侧栏的过程中不重新取频谱（第一次测量立即生效）。
    let timer: number | undefined
    let measured = false
    const observer = new ResizeObserver(([entry]) => {
      window.clearTimeout(timer)
      const next = Math.round(entry.contentRect.width * Math.max(1, window.devicePixelRatio || 1))
      if (!measured) { measured = true; setColumns(next); return }
      timer = window.setTimeout(() => setColumns(next), 150)
    })
    observer.observe(element)
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [])
  const placement = recording ? capture.store.getState().placement : null
  const insertion = placement ? { start: placement.startFrame, frames: placement.endFrame > placement.startFrame ? Math.min(liveFrames, placement.endFrame - placement.startFrame) : liveFrames, replace: placement.endFrame > placement.startFrame } : undefined
  const spectralView = insertion && !insertion.replace ? { start: Math.max(0, editor.view.start - insertion.frames), end: editor.view.end } : editor.view
  // 频谱只跟声音内容走：删除、静音不改声音，作品版本变了也沿用已算好的频谱
  const audioContentKey = soundKey
  const audioRevision = React.useRef({ key: audioContentKey, revision: project.revision })
  if (audioRevision.current.key !== audioContentKey) audioRevision.current = { key: audioContentKey, revision: project.revision }
  const spectrogram = useAudioEditSpectral(audioEditSpectralClient, project.id, spectralView, columns, duration, edited ? 'edited' : 'source', audioRevision.current.revision, JSON.stringify([project.source.audioPath, project.source.identity]), soundKey)
  // 标记以剪后时间线为准：文字稿删掉的词和波形上删除的区间都是“删除”，相邻的合并成一段；静音按剪后片段的静音标记；停顿预览是“待处理”。
  const spans = React.useMemo(() => buildProjectAudioEditTimeline(project), [project])
  const pending = workspace.silencePreview.ranges
  const cutRanges = React.useMemo(() => {
    const ranges: Array<{ start: number; end: number; mode: 'delete' | 'mute' | 'pending' }> = []
    let cursor = 0
    for (const span of spans) {
      if (cursor < span.sourceStartFrame) ranges.push({ start: cursor, end: span.sourceStartFrame, mode: 'delete' })
      if (span.muted) ranges.push({ start: span.sourceStartFrame, end: span.sourceEndFrame, mode: 'mute' })
      cursor = span.sourceEndFrame
    }
    if (cursor < duration) ranges.push({ start: cursor, end: duration, mode: 'delete' })
    return [...ranges, ...pending.map(range => ({ start: range.startFrame, end: range.endFrame, mode: 'pending' as const }))]
  }, [spans, duration, pending])
  // 口水音位置：只在效果控件里选中“去除口水音”时标出来（处理的橙色、关掉不处理的灰色），平时不占画面
  const effectSelection = useAudioEditEffectSelection()
  const selectedEffectId = effectSelection.projectId === project.id ? effectSelection.selectedId : ''
  const marks = React.useMemo(() => {
    const item = project.effectChain?.find(candidate => candidate.id === selectedEffectId)
    if (item?.kind !== 'mouth_declick') return undefined
    return [...item.clicks.map(click => ({ start: click.startFrame, end: click.endFrame })), ...(item.skipped ?? []).map(click => ({ start: click.startFrame, end: click.endFrame, off: true }))]
  }, [project.effectChain, selectedEffectId])
  const toggleMark = (mark: { start: number; end: number; off?: boolean }): void => {
    workspace.update({ effectChain: (project.effectChain ?? []).map(item => item.id === selectedEffectId && item.kind === 'mouth_declick'
      ? setAudioEditMouthClicksSkipped(item, { startFrame: mark.start, endFrame: mark.end }, !mark.off) : item) })
  }
  const repairs = React.useMemo(() => (project.repairs ?? []).filter(repair => repair.enabled && repair.kind === 'spectral_heal').map(repair => ({ id: repair.id, start: repair.startFrame, end: repair.endFrame, lowHz: repair.lowHz, highHz: repair.highHz })), [project.repairs])
  const visibleCuts = insertion ? spliceAudioRanges(cutRanges.map((range, index) => ({ ...range, id: String(index), startFrame: range.start, endFrame: range.end })), insertion.start, insertion.start + (insertion.replace ? insertion.frames : 0), insertion.frames).map(range => ({ ...range, start: range.startFrame, end: range.endFrame })) : cutRanges
  const menu = useContextMenu()
  // 播放时播放头跑出视野就翻页跟随（订阅播放位置，不让整个面板每帧重新渲染）。
  const viewRef = React.useRef(editor.view)
  viewRef.current = editor.view
  const setView = editor.setView
  React.useEffect(() => playheadSource.subscribe((frame) => {
    const view = viewRef.current
    if (!useAudioEditPlaybackStore.getState().playing || (frame >= view.start && frame <= view.end)) return
    const length = view.end - view.start
    const start = Math.max(0, Math.min(duration - length, frame - length * 0.1))
    setView({ start, end: start + length })
  }), [duration, setView])
  // 吸附开着时取一次逐帧电平（与停顿压缩同一分析，有缓存），算出字声音的起止点
  const [speechEdges, setSpeechEdges] = React.useState<number[]>([])
  const batchSettings = React.useRef(project.batchSettings)
  batchSettings.current = project.batchSettings
  React.useEffect(() => {
    setSpeechEdges([])
    if (!editor.snapToSpeech || !duration) return
    let cancelled = false
    void getPlatform().audioEdit.detectSilence({ projectId: project.id, settings: batchSettings.current ?? DEFAULT_AUDIO_EDIT_SETTINGS, requestId: crypto.randomUUID(), energy: { levels: true } })
      .then(result => { if (!cancelled && result.energy?.levels) setSpeechEdges(audioEditSpeechEdges({ resolutionMs: result.energy.resolutionMs, wideDb: result.energy.levels.wideDb }, rate)) }, () => undefined)
    return () => { cancelled = true }
  }, [editor.snapToSpeech, project.id, duration, rate])
  // 刚打开、还没点过任何地方时按空格就能播放：焦点还在页面本身时也交给试听
  const togglePlayback = workspace.togglePlayback
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== ' ' || event.target !== document.body || recording || disabled || event.ctrlKey || event.metaKey || event.altKey) return
      event.preventDefault(); void togglePlayback()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlayback, recording, disabled])
  React.useEffect(() => { if (!document.activeElement || document.activeElement === document.body) host.current?.focus({ preventScroll: true }) }, [project.id])
  const iconSize = UI_ICON_SIZE.md
  return <div ref={host} className="flex h-full min-h-0 flex-col outline-none" data-spectrogram-mode={edited ? 'edited' : 'source'} data-audio-edit-panel="editor" onKeyDown={(event) => {
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable="true"]')) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const tool = audioWaveToolForKey(event.key)
    if (tool && !recording) { event.preventDefault(); editor.setTool(tool); return }
    if (event.key === 'Escape') { onSelection(null); editor.setSpectralSelection(null); return }
    if (!recording && !disabled && event.key === ' ' && !(event.target instanceof HTMLElement && event.target.closest('button'))) { event.preventDefault(); void workspace.togglePlayback(); return }
    if (selection && !disabled && (event.key === 'Delete' || event.key.toLowerCase() === 'm')) { event.preventDefault(); onEditSelection(event.key === 'Delete' ? 'delete' : 'mute') }
  }} tabIndex={-1}>
    {/* 编辑工具放在“编辑器”标签行右侧；面板组太窄时留在面板顶部这一行。 */}
    <DockHeaderPortal panelId="audio_edit:editor" fallback={tools => <div className="flex h-band-header shrink-0 items-center border-b border-gap px-2">{tools}</div>}>
      <AudioWaveToolbar editor={editor} selection={selection} disabled={disabled} actions={workspace.waveActions} onEditSelection={onEditSelection} />
    </DockHeaderPortal>
    <div className="min-h-0 flex-1">
      <AudioSpectralEditor sampleRate={rate} durationFrames={recording ? liveDuration : duration || rate * 10} empty={!duration}
        {...(recording ? { insertion, recordingOverlay: (mode, frequency) => <AudioCapturePreview mode={mode} frequency={frequency} view={editor.view} rate={rate} /> } : {})} waveform={waveform}
        {...(spectrogram.tiles ? { spectrogram: spectrogram.tiles } : {})} spectrogramStatus={spectrogram.status} {...(spectrogram.computing ? { spectrogramComputing: true } : {})} {...(spectrogram.error ? { spectrogramError: spectrogram.error } : {})} onRetrySpectrogram={spectrogram.retry}
        view={editor.view} onViewChange={editor.setView} display={editor.display} tool={recording ? 'hand' : editor.tool} brushPixels={editor.brushPixels}
        playhead={playheadSource} onSeek={frame => { if (!recording) onSeek(frame) }} displayGain={autoGain ? workspace.previewGain : 1}
        onScrubStart={frame => { if (!recording) audioEditScrub(project.id)?.start(frame) }}
        onScrubMove={frame => { if (!recording) audioEditScrub(project.id)?.move(frame) }}
        onScrubEnd={() => audioEditScrub(project.id)?.end()}
        onScrubStep={frame => { if (!recording) audioEditScrub(project.id)?.step(frame) }}
        selection={selection ? { start: selection.startFrame, end: selection.endFrame } : null}
        onSelectionChange={(next) => { if (!recording) onSelection(next && next.end > next.start ? { startFrame: next.start, endFrame: next.end } : null) }}
        spectralSelection={editor.spectralSelection} onSpectralSelectionChange={editor.setSpectralSelection}
        onBrushStroke={stroke => { if (!disabled) actions.healStroke(stroke) }} cutRanges={visibleCuts} repairs={recording ? [] : repairs}
        snapEnabled={editor.snapToSpeech} {...(marks ? { marks, ...(disabled ? {} : { onMarkToggle: toggleMark }) } : {})} {...(speechEdges.length ? { snapFrames: speechEdges } : {})}
        {...(recording || disabled ? {} : { onCutEdgeEdit: ({ range: edited, mode, action }: { range: { start: number; end: number }; mode: 'delete' | 'mute'; action: 'add' | 'remove' }) => workspace.adjustCutRange({ startFrame: edited.start, endFrame: edited.end }, mode, action) })}
        {...(project.transcript.length && (project.viewSettings?.timelineCaptions ?? true) ? { captionLane: <CaptionLane view={editor.view} /> } : {})}
        onContextMenu={(event) => menu.showMenu(event, [
          { id: 'heal', label: '修复框选区域', icon: <Wand2 size={iconSize} />, disabled: !editor.spectralSelection || disabled, onClick: () => { actions.healArea(editor.spectralSelection!); editor.setSpectralSelection(null) } },
          { id: 'delete', label: '删除选区 · Delete', icon: <Trash2 size={iconSize} />, disabled: !selection || disabled, onClick: () => onEditSelection('delete') },
          { id: 'mute', label: '静音选区 · M', icon: <VolumeX size={iconSize} />, disabled: !selection || disabled, onClick: () => onEditSelection('mute') },
          { id: 'fade-in', label: '淡入', icon: <MoveRight size={iconSize} />, disabled: !selection || disabled, onClick: () => actions.fadeIn(selection!) },
          { id: 'fade-out', label: '淡出', icon: <MoveLeft size={iconSize} />, disabled: !selection || disabled, onClick: () => actions.fadeOut(selection!) },
          { id: 'declick', label: '去爆音', icon: <Wand2 size={iconSize} />, disabled: !selection || disabled || !actions.canDeclick(selection), onClick: () => actions.declick(selection!) },
          { id: 'restore', label: '恢复选区', icon: <RotateCcw size={iconSize} />, disabled: !selection || disabled, onClick: () => onEditSelection('restore') },
        ])} />
    </div>
    <AudioEditTransport viewDuration={recording ? liveDuration : duration || rate * 10} />
    <ContextMenu visible={menu.menuVisible} position={menu.menuPosition} items={menu.menuItems} onClose={menu.hideMenu} />
  </div>
}
