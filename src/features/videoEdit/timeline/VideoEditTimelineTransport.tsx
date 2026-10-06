import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { UiInput } from '@/components/ui'
import { parseVideoEditTimecodeInput, videoEditFrameCount } from '@/core/videoEdit/timecode'
import { videoEditDuration } from '@/core/videoEdit/document'
import { getActiveVideoEditSequence, setVideoEditView, subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { TIMELINE_HEADER_WIDTH, timelineTimecode } from './timelineGeometry'

/** 时间码的显示方式（Premiere：Ctrl+点击时间码在“时间码 / 帧号”之间切换），节目监视器与时间线共用，本机记住。 */
type TimecodeDisplay = 'timecode' | 'frames'
const DISPLAY_KEY = 'henji.videoEdit.timecodeDisplay'
const displayListeners = new Set<() => void>()
let timecodeDisplay: TimecodeDisplay = (() => { try { return localStorage.getItem(DISPLAY_KEY) === 'frames' ? 'frames' : 'timecode' } catch { return 'timecode' } })()
function toggleTimecodeDisplay(): void {
  timecodeDisplay = timecodeDisplay === 'frames' ? 'timecode' : 'frames'
  try { localStorage.setItem(DISPLAY_KEY, timecodeDisplay) } catch { /* 只是本机偏好，存不下就只在本次运行生效 */ }
  displayListeners.forEach(listener => listener())
}
function subscribeTimecodeDisplay(listener: () => void): () => void { displayListeners.add(listener); return () => { displayListeners.delete(listener) } }

/**
 * 时间码（Premiere 的“播放指示器位置”）：节目监视器与时间线共用。
 * - 左右拖动快速移动播放头（按住 Shift 每像素 10 帧）；
 * - 单击进入输入：纯数字从右往左两位一组（1230 = 12 秒 30 帧），超出自动进位，+/− 为相对移动，回车跳转、Esc 取消；
 * - Ctrl+单击在时间码与帧号之间切换显示。
 */
export function VideoEditTimecode({ instance, label, className = '' }: { instance: VideoEditInstance; label: string; className?: string }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const display = useSyncExternalStore(subscribeTimecodeDisplay, () => timecodeDisplay)
  const sequence = getActiveVideoEditSequence(instance)
  const [editing, setEditing] = useState<string | null>(null)
  const drag = useRef<{ x: number; frame: number; moved: boolean; pointerId: number } | null>(null)
  const maxFrame = Math.floor(sequence.fps * 1800)
  const text = display === 'frames' ? videoEditFrameCount(instance.frame) : `${timelineTimecode(instance.frame, sequence.fps)}${Number.isInteger(sequence.fps) ? '' : ' NDF'}`
  const seek = (frame: number, scrubbing = false): void => { setVideoEditView(instance.document.id, { frame: Math.max(0, Math.min(maxFrame, Math.round(frame))), playing: false, scrubbing }) }
  const commit = (value: string): void => {
    const frame = parseVideoEditTimecodeInput(value, sequence.fps, instance.frame, display)
    if (frame !== null) seek(frame)
    setEditing(null)
  }
  if (editing !== null) {
    return <UiInput autoFocus size="sm" aria-label={`${label}（输入时间）`} className={`w-28 font-mono tabular-nums ${className}`} value={editing}
      onFocus={event => event.currentTarget.select()} onChange={event => setEditing(event.target.value)} onBlur={() => setEditing(null)}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); commit(editing) } else if (event.key === 'Escape') { event.preventDefault(); setEditing(null) } }} />
  }
  return <span role="spinbutton" tabIndex={0} aria-label={label} aria-valuenow={instance.frame} aria-valuemin={0} aria-valuemax={maxFrame} aria-valuetext={text}
    title="拖动快速定位；单击输入时间（如 1230 = 12 秒 30 帧）；Ctrl+单击切换时间码 / 帧号"
    className={`shrink-0 cursor-ew-resize select-none font-mono tabular-nums text-accent-text ${className}`}
    onPointerDown={event => {
      if (event.button !== 0) return
      if (event.ctrlKey || event.metaKey) { event.preventDefault(); toggleTimecodeDisplay(); return }
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, frame: instance.frame, moved: false, pointerId: event.pointerId }
    }}
    onPointerMove={event => {
      const state = drag.current; if (!state || state.pointerId !== event.pointerId) return
      const dx = event.clientX - state.x
      if (!state.moved && Math.abs(dx) < 3) return
      state.moved = true
      seek(state.frame + dx * (event.shiftKey ? 10 : 1), true)
    }}
    onPointerUp={event => {
      const state = drag.current; drag.current = null
      if (!state || state.pointerId !== event.pointerId) return
      if (state.moved) seek(instance.frame)
      else setEditing(display === 'frames' ? videoEditFrameCount(instance.frame) : timelineTimecode(instance.frame, sequence.fps))
    }}
    onPointerCancel={() => { if (drag.current?.moved) seek(instance.frame); drag.current = null }}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); setEditing(display === 'frames' ? videoEditFrameCount(instance.frame) : timelineTimecode(instance.frame, sequence.fps)) }
    }}>{text}</span>
}

/**
 * 入出点持续时间（PR 节目监视器右侧的读数）：设了序列入点或出点时显示入点到出点的时长，只设一端时算到序列开头或结尾。
 */
export function VideoEditInOutDuration({ instance, className = '' }: { instance: VideoEditInstance; className?: string }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  if (instance.inFrame === null && instance.outFrame === null) return null
  const sequence = getActiveVideoEditSequence(instance)
  const frames = Math.max(0, (instance.outFrame ?? videoEditDuration(sequence)) - (instance.inFrame ?? 0))
  return <span aria-label="入出点持续时间" title="入出点持续时间" data-video-edit-in-out-duration={frames}
    className={`shrink-0 select-none font-mono tabular-nums text-text2 ${className}`}>{timelineTimecode(frames, sequence.fps)}</span>
}
/** 播放头：强调色竖线（设计稿 VideoEdit；强调色只用于主动作、焦点、播放头与选中指示）。 */
export function VideoEditTimelinePlayhead({ instance, pixels }: { instance: VideoEditInstance; pixels: number }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  return <div className="pointer-events-none absolute bottom-0 top-0 z-raised w-px bg-accent-ring" style={{ left: TIMELINE_HEADER_WIDTH + instance.frame * pixels }} data-video-edit-playhead />
}
/** 播放头在标尺上的“头”（Premiere 的蓝色指示器）：标尺压在轨道之上，竖线画不进标尺，头放在标尺里，下端接竖线。 */
const PLAYHEAD_HEAD_SHAPE = { clipPath: 'polygon(0 0, 100% 0, 100% 55%, 50% 100%, 0 55%)' }
export function VideoEditTimelinePlayheadHead({ instance, pixels }: { instance: VideoEditInstance; pixels: number }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  return <div aria-hidden="true" data-video-edit-playhead-head className="pointer-events-none absolute bottom-0 top-0 z-raised -ml-1.5 flex w-3 flex-col items-center" style={{ left: instance.frame * pixels }}>
    <div className="mt-auto h-3 w-3 bg-accent-ring" style={PLAYHEAD_HEAD_SHAPE} />
    <div className="h-1 w-px bg-accent-ring" />
  </div>
}
export function VideoEditTimelinePosition({ instance, children }: { instance: VideoEditInstance; children: ReactNode }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  return <div className="relative min-w-0 flex-1" role="slider" tabIndex={0} aria-label="剪辑时间定位" aria-valuemin={0} aria-valuemax={Math.floor(getActiveVideoEditSequence(instance).fps * 1800)} aria-valuenow={instance.frame}>{children}</div>
}
