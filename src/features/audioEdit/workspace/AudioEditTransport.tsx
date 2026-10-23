import { AudioEditRecordingControls } from './AudioEditRecordingControls'
import { useMemo } from 'react'
import { useStore } from 'zustand'
import { getAudioCaptureSession } from '@/features/audioCapture'
import { Expand, Keyboard, MoreHorizontal, Pause, Play, SkipBack, Volume2, ZoomIn, ZoomOut } from 'lucide-react'
import { PanelTrigger, UiIconButton, UiInlineStatus, UiOverflowRow, UiRangeInput, UiSwitch, type UiOverflowRowItem } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'
import { AUDIO_EDIT_MIN_VIEW_FRAMES, zoomViewport } from '../waveformViewport'
import { useAudioEditWorkspace } from './audioEditWorkspaceContext'

const SHORTCUTS: Array<[string, string]> = [
  ['空格', '播放 / 暂停'],
  ['Shift+空格 / R', '录音 / 停止'],
  ['V / E / B / H', '时间选区 / 框选频谱 / 修复画笔 / 平移'],
  ['滚轮', '以指针为中心缩放'],
  ['Shift + 滚轮 / 按住滚轮拖动', '平移'],
  ['刻度上滚轮', '缩放波形高度 / 频率范围'],
  ['Delete / M', '删除 / 静音选区'],
  ['Esc', '取消选区'],
  ['Ctrl + F', '查找与替换'],
  ['Ctrl + Z', '撤销'],
]

function preciseTime(frame: number, rate: number) {
  const seconds = Math.max(0, frame / rate)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${(seconds % 60).toFixed(3).padStart(6, '0')}`
}

/** 时间码单独订阅播放位置：播放时只有这一小段文字每帧更新。 */
function Timecode({ rate, total }: { rate: number; total: number }) {
  const outputFrame = useAudioEditPlaybackStore((state) => state.outputFrame)
  return <span className={`${UI_TEXT_TIMECODE_CLASS} shrink-0 whitespace-nowrap`} data-audio-edit-time>
    <span className="text-base text-accent">{preciseTime(outputFrame, rate)}</span><span className="text-xs text-text3"> / {preciseTime(total, rate)}</span>
  </span>
}

/** 编辑器底部的走带：播放、时间码、缩放与试听设置。 */
export function AudioEditTransport({ viewDuration }: { viewDuration?: number } = {}) {
  const workspace = useAudioEditWorkspace()
  const { project, delivery, wave } = workspace
  const { durationFrames: duration, sampleRate: rate } = project.source
  const zoomDuration = viewDuration ?? duration
  const playing = useAudioEditPlaybackStore((state) => state.playing)
  const preparing = useAudioEditPlaybackStore((state) => state.preparing)
  const ready = useAudioEditPlaybackStore((state) => state.ready)
  const error = useAudioEditPlaybackStore((state) => state.error)
  const autoGain = useAudioEditPlaybackStore((state) => state.autoGain)
  const volume = useAudioEditPlaybackStore((state) => state.volume)
  const mode = useAudioEditPlaybackStore((state) => state.mode)
  const setAutoGain = useAudioEditPlaybackStore((state) => state.setAutoGain)
  const setVolume = useAudioEditPlaybackStore((state) => state.setVolume)
  const capture = useStore(getAudioCaptureSession().store)
  const recording = capture.placement?.projectId === project.id && (capture.phase === 'recording' || capture.phase === 'paused')
  const spans = useMemo(() => buildProjectAudioEditTimeline(project), [project])
  const editedDuration = useMemo(() => editedDurationFrames(spans), [spans])
  const playDuration = mode === 'source' ? duration : mode === 'delivery' ? editedDurationFrames(delivery.timeline?.spans ?? []) : editedDuration
  const removedFrames = Math.max(0, duration - editedDuration)
  const preview = workspace.silencePreview
  const readouts = [
    mode !== 'source' && removedFrames > 0 ? `已剪去 ${(removedFrames / rate).toFixed(1)} 秒` : '',
    preparing ? '正在准备试听…' : '',
    preview.error || (preview.pending ? '正在更新停顿预览…' : ''),
  ].filter(Boolean)
  const zoom = (factor: number) => {
    const view = wave.view
    const frame = useAudioEditPlaybackStore.getState().sourceFrame
    const anchor = frame >= view.start && frame <= view.end ? (frame - view.start) / Math.max(1, view.end - view.start) : 0.5
    wave.setView(zoomViewport(view, anchor, factor, zoomDuration, Math.min(zoomDuration, AUDIO_EDIT_MIN_VIEW_FRAMES)))
  }
  const fullView = wave.view.start <= 0 && wave.view.end >= zoomDuration
  const items: UiOverflowRowItem[] = [
    ...(readouts.length ? [{ id: 'readouts', priority: 10, node: <span className="max-w-56 truncate whitespace-nowrap text-xs text-text3" aria-live="polite" title={readouts.join(' · ')}>{readouts.join(' · ')}</span> }] : []),
    ...(error ? [{ id: 'error', priority: 100, pinned: true, node: <UiInlineStatus role="alert" className="min-w-0 truncate" tooltip={error}>{error}</UiInlineStatus> }] : []),
    { id: 'zoom', priority: 80, node: <div className="flex items-center" role="group" aria-label="缩放">
      <UiIconButton size="sm" aria-label="放大" tooltip="放大" onClick={() => zoom(0.5)}><ZoomIn /></UiIconButton>
      <UiIconButton size="sm" aria-label="缩小" tooltip="缩小" disabled={fullView} disabledReason="已经显示全部" onClick={() => zoom(2)}><ZoomOut /></UiIconButton>
      <UiIconButton size="sm" aria-label="显示全部" tooltip="显示全部" disabled={fullView} disabledReason="已经显示全部" onClick={() => wave.setView({ start: 0, end: zoomDuration })}><Expand /></UiIconButton>
    </div> },
    { id: 'gain', priority: 40, node: <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-text2" title="自动放大小声录音，仅影响试听，不改变导出音量">
      <UiSwitch checked={mode !== 'delivery' && autoGain} disabled={mode === 'delivery'} onCheckedChange={setAutoGain} aria-label="试听自动增益" />自动增益
    </label> },
    { id: 'volume', priority: 50, node: <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-text2" title={`试听音量 ${Math.round(volume * 100)}%`}>
      <Volume2 size={UI_ICON_SIZE.sm} aria-hidden="true" className="text-text3" />
      <UiRangeInput className="!w-20 shrink-0" aria-label="试听音量" min={0} max={100} step={1} value={Math.round(volume * 100)} onChange={(event) => setVolume(Number(event.target.value) / 100)} />
    </label> },
    { id: 'help', priority: 30, node: <PanelTrigger panelSize="menu" panelPadding="content" renderPanel={() => (
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
        {SHORTCUTS.map(([key, label]) => <div key={key} className="contents"><dt className="font-mono text-text1">{key}</dt><dd className="text-text2">{label}</dd></div>)}
      </dl>
    )}>
      {({ open, togglePanel }) => <UiIconButton size="sm" aria-label="快捷键" tooltip="快捷键" on={open} aria-expanded={open} onClick={togglePanel} data-panel-trigger-button><Keyboard /></UiIconButton>}
    </PanelTrigger> },
  ]
  return <div className="flex h-10 shrink-0 items-center gap-1.5 border-t border-gap bg-panel px-2" data-audio-transport>
    <UiIconButton size="md" disabled={workspace.disabled || !ready} disabledReason="请先录入音频或暂停录音" onClick={() => workspace.seek(0)} tooltip="回到开头" aria-label="回到开头"><SkipBack /></UiIconButton>
    <UiIconButton size="md" disabled={workspace.disabled || !ready || playDuration === 0} disabledReason={!duration ? '请先录入音频' : workspace.disabled ? '请先暂停录音或等待处理完成' : '正在准备试听'} onClick={() => void workspace.togglePlayback()} tooltip={playing ? '暂停 · 空格' : '播放 · 空格'} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause /> : <Play />}</UiIconButton>
    <AudioEditRecordingControls />
    {/* 录音中走带只显示录音计时与电平（录音控件里），播放时间码此时没有意义，第一段录音时总长还是 0。 */}
    {!recording && <Timecode rate={rate} total={playDuration} />}
    <UiOverflowRow className="flex-1 justify-end gap-1" items={items} renderOverflow={(hiddenIds) => (
      <PanelTrigger panelSize="compact" panelPadding="content" renderPanel={() => (
        <div className="flex flex-col items-start gap-3">{items.filter((item) => hiddenIds.includes(item.id)).map((item) => <div key={item.id} className="flex flex-wrap items-center gap-1.5">{item.node}</div>)}</div>
      )}>
        {({ open, togglePanel }) => <UiIconButton size="sm" aria-label="更多播放控制" tooltip="更多播放控制" on={open} aria-expanded={open} onClick={togglePanel} data-panel-trigger-button><MoreHorizontal /></UiIconButton>}
      </PanelTrigger>
    )} />
  </div>
}
