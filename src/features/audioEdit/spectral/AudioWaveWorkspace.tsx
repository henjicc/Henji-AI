import React from 'react'
import { Brush, Hand, MoveLeft, MoveRight, RotateCcw, SquareDashed, TextCursor, Trash2, Volume1, VolumeX, Wand2 } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { PanelTrigger, UiButton, UiFormRow, UiIconButton, UiRangeInput, UiSegmented } from '@/components/ui'
import { useContextMenu } from '@/hooks/useContextMenu'
import NumberInput from '@/components/ui/NumberInput'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import type { AudioEditProjectDocument, AudioEditRange } from '@/core/audioEdit/types'
import { useWaveformData } from '@/hooks/useWaveformData'
import { getPlatform } from '@/platform/runtime'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'
import { AudioSpectralEditor } from './AudioSpectralEditor'
import type { AudioEditorTool } from './spectralEditorModel'
import { audioWaveToolForKey, type audioWaveActions, type AudioWaveEditorState } from './audioWaveEditorState'
import { useAudioEditSpectrogram } from './useAudioEditSpectrogram'

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
      {TOOLS.map(tool => <UiIconButton key={tool.id} size="sm" on={editor.tool === tool.id} aria-pressed={editor.tool === tool.id} aria-label={tool.label} tooltip={tool.label} onClick={() => editor.setTool(tool.id)}>{tool.icon}</UiIconButton>)}
    </div>
    <UiSegmented ariaLabel="显示" size="sm" value={editor.display} onChange={editor.setDisplay}
      options={[{ value: 'both', label: '都显示' }, { value: 'waveform', label: '波形' }, { value: 'spectrum', label: '频谱' }]} />
    {editor.tool === 'brush' && <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-text2">
      画笔
      <UiRangeInput className="!w-24 shrink-0" aria-label="画笔大小" min={4} max={48} step={1} value={editor.brushPixels} onChange={event => editor.setBrushPixels(Number(event.target.value))} />
    </label>}
    <div className="ml-auto flex min-w-0 items-center gap-0.5">
      {editor.spectralSelection && <UiButton size="sm" disabled={disabled} disabledReason="正在处理，请稍候" tooltip="用周围的声音补上框选区域，去掉其中的杂音" onClick={() => { actions.healArea(editor.spectralSelection!); editor.setSpectralSelection(null) }}><Wand2 className="mr-1" />修复框选区域</UiButton>}
      {selection && <>
        <UiButton size="sm" variant="danger" disabled={disabled} disabledReason="正在处理，请稍候" tooltip="删除选区 · Delete" onClick={() => onEditSelection('delete')}><Trash2 className="mr-1" />删除</UiButton>
        <UiButton size="sm" disabled={disabled} disabledReason="正在处理，请稍候" tooltip="静音选区 · M" onClick={() => onEditSelection('mute')}><VolumeX className="mr-1" />静音</UiButton>
        <PanelTrigger panelSize="compact" panelPadding="content" open={gainOpen} onOpenChange={setGainOpen} renderPanel={() => <div className="flex w-56 flex-col gap-3">
          <UiFormRow label="音量（dB）" density="compact"><NumberInput ariaLabel="音量变化（dB）" value={gainDb} min={-60} max={24} step={0.5} precision={1} onChange={setGainDb} /></UiFormRow>
          <UiButton variant="secondary" disabled={disabled} disabledReason="正在处理，请稍候" onClick={() => { actions.gain(selection, gainDb); setGainOpen(false) }}>应用到选区</UiButton>
        </div>}>
          {({ open, togglePanel }) => <UiButton size="sm" disabled={disabled} disabledReason="正在处理，请稍候" aria-expanded={open} onClick={togglePanel} data-panel-trigger-button><Volume1 className="mr-1" />音量</UiButton>}
        </PanelTrigger>
        <UiButton size="sm" disabled={disabled} disabledReason="正在处理，请稍候" tooltip="选区内从无声渐强到原音量" onClick={() => actions.fadeIn(selection)}><MoveRight className="mr-1" />淡入</UiButton>
        <UiButton size="sm" disabled={disabled} disabledReason="正在处理，请稍候" tooltip="选区内从原音量渐弱到无声" onClick={() => actions.fadeOut(selection)}><MoveLeft className="mr-1" />淡出</UiButton>
        {actions.canDeclick(selection) && <UiButton size="sm" disabled={disabled} disabledReason="正在处理，请稍候" tooltip="用前后的声音补上这一小段，去掉爆音、咔嗒声" onClick={() => actions.declick(selection)}><Wand2 className="mr-1" />去爆音</UiButton>}
        <UiButton size="sm" disabled={disabled} disabledReason="正在处理，请稍候" onClick={() => onEditSelection('restore')}><RotateCcw className="mr-1" />恢复</UiButton>
      </>}
    </div>
  </div>
}

export function AudioWaveWorkspace({ project, editor, selection, onSelection, onSeek, onEditSelection, actions, disabled }: {
  project: AudioEditProjectDocument
  editor: AudioWaveEditorState
  selection: AudioEditRange | null
  onSelection: (range: AudioEditRange | null) => void
  onSeek: (frame: number) => void
  onEditSelection: (mode: 'delete' | 'mute' | 'restore') => void
  actions: ReturnType<typeof audioWaveActions>
  disabled: boolean
}) {
  const { durationFrames: duration, sampleRate: rate } = project.source
  const sourceFrame = useAudioEditPlaybackStore(state => state.sourceFrame)
  const edited = Boolean(project.repairs?.some(repair => repair.enabled) || project.gainRegions?.some(region => region.enabled))
  // 有修复或区间音量时，波形改读“已编辑、未删除”的音频（时间轴同原素材），删除与静音仍用叠加标记表示。
  const [editedPath, setEditedPath] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!edited) { setEditedPath(null); return }
    let cancelled = false
    const timer = window.setTimeout(() => void getPlatform().audioEdit.editedSource({ projectId: project.id }).then(result => { if (!cancelled) setEditedPath(result.audioPath) }, () => undefined), 150)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [edited, project.id, project.repairs, project.gainRegions])
  const channels: 1 | 2 = project.source.channels > 1 ? 2 : 1
  const waveformSource = editedPath ?? project.source.audioPath
  const waveform = useWaveformData(waveformSource ? { source: waveformSource, channels } : null, 'full')
  const [columns, setColumns] = React.useState(0)
  const host = React.useRef<HTMLDivElement | null>(null)
  React.useLayoutEffect(() => {
    const element = host.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setColumns(Math.round(entry.contentRect.width * Math.max(1, window.devicePixelRatio || 1))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const spectrogram = useAudioEditSpectrogram(project.id, editor.view, columns, duration, edited ? 'edited' : 'source', project.revision)
  const cutRanges = React.useMemo(() => (project.cuts ?? []).filter(cut => cut.enabled).map(cut => ({ start: cut.startFrame, end: cut.endFrame, mode: cut.mode ?? 'delete' as const })), [project.cuts])
  const repairs = React.useMemo(() => (project.repairs ?? []).filter(repair => repair.enabled && repair.kind === 'spectral_heal').map(repair => ({ id: repair.id, start: repair.startFrame, end: repair.endFrame, lowHz: repair.lowHz, highHz: repair.highHz })), [project.repairs])
  const menu = useContextMenu()
  // 播放时播放头跑出视野就翻页跟随。
  React.useEffect(() => {
    const { view, setView } = editor
    if (sourceFrame < view.start || sourceFrame > view.end) {
      const length = view.end - view.start
      setView({ start: Math.max(0, Math.min(duration - length, sourceFrame - length * 0.1)), end: Math.max(0, Math.min(duration - length, sourceFrame - length * 0.1)) + length })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- follow only when the playhead moves
  }, [sourceFrame])
  const iconSize = UI_ICON_SIZE.md
  return <div ref={host} className="h-full min-h-0" data-spectrogram-mode={edited ? 'edited' : 'source'} onKeyDown={(event) => {
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable="true"]')) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const tool = audioWaveToolForKey(event.key)
    if (tool) { event.preventDefault(); editor.setTool(tool); return }
    if (event.key === 'Escape') { onSelection(null); editor.setSpectralSelection(null); return }
    if (selection && !disabled && (event.key === 'Delete' || event.key.toLowerCase() === 'm')) { event.preventDefault(); onEditSelection(event.key === 'Delete' ? 'delete' : 'mute') }
  }} tabIndex={-1}>
    <AudioSpectralEditor sampleRate={rate} durationFrames={duration} waveform={waveform}
      {...(spectrogram.data ? { spectrogram: spectrogram.data } : {})} spectrogramStatus={spectrogram.status} {...(spectrogram.error ? { spectrogramError: spectrogram.error } : {})} onRetrySpectrogram={spectrogram.retry}
      view={editor.view} onViewChange={editor.setView} display={editor.display} tool={editor.tool} brushPixels={editor.brushPixels}
      playheadFrame={sourceFrame} onSeek={onSeek}
      selection={selection ? { start: selection.startFrame, end: selection.endFrame } : null}
      onSelectionChange={(next) => onSelection(next && next.end > next.start ? { startFrame: next.start, endFrame: next.end } : null)}
      spectralSelection={editor.spectralSelection} onSpectralSelectionChange={editor.setSpectralSelection}
      onBrushStroke={actions.healStroke} cutRanges={cutRanges} repairs={repairs}
      onContextMenu={(event) => menu.showMenu(event, [
        { id: 'heal', label: '修复框选区域', icon: <Wand2 size={iconSize} />, disabled: !editor.spectralSelection || disabled, onClick: () => { actions.healArea(editor.spectralSelection!); editor.setSpectralSelection(null) } },
        { id: 'delete', label: '删除选区 · Delete', icon: <Trash2 size={iconSize} />, disabled: !selection || disabled, onClick: () => onEditSelection('delete') },
        { id: 'mute', label: '静音选区 · M', icon: <VolumeX size={iconSize} />, disabled: !selection || disabled, onClick: () => onEditSelection('mute') },
        { id: 'fade-in', label: '淡入', icon: <MoveRight size={iconSize} />, disabled: !selection || disabled, onClick: () => actions.fadeIn(selection!) },
        { id: 'fade-out', label: '淡出', icon: <MoveLeft size={iconSize} />, disabled: !selection || disabled, onClick: () => actions.fadeOut(selection!) },
        { id: 'declick', label: '去爆音', icon: <Wand2 size={iconSize} />, disabled: !selection || disabled || !actions.canDeclick(selection), onClick: () => actions.declick(selection!) },
        { id: 'restore', label: '恢复选区', icon: <RotateCcw size={iconSize} />, disabled: !selection || disabled, onClick: () => onEditSelection('restore') },
      ])} />
    <ContextMenu visible={menu.menuVisible} position={menu.menuPosition} items={menu.menuItems} onClose={menu.hideMenu} />
  </div>
}

