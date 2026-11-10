import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { videoEditDuration } from '@/core/videoEdit/document'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { getActiveVideoEditSequence, setVideoEditView, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { sameVideoEditViewFields, useVideoEditViewSelector } from '../application/useVideoEditViewSelector'
import { requestVideoEditScrub } from '../engine/videoEditAudioScrub'
import { TIMELINE_PLAYHEAD_HEAD_SHAPE, timelineRulerLabel, timelineRulerScale } from './timelineGeometry'
import { VideoEditZoomBarTrack } from './VideoEditTimelineZoomBar'

/** 标尺两端留出的像素：播放头的头在 0 帧和最后一帧时也画得全。 */
const RULER_INSET = 8
/** 拖缩放条两端最短看得见的帧数。 */
const MIN_VISIBLE_FRAMES = 10

/**
 * 节目监视器下的时间标尺（PR 节目监视器的时间轴）：默认铺满整条序列，任意位置单击或拖动定位播放头，
 * 显示入出点；下面的缩放条拖两端放大一段、拖中间平移。看得见的范围只是这块面板的视图状态。
 */
export function VideoEditProgramRuler({ instance }: { instance: VideoEditInstance }): React.ReactElement {
  useVideoEditViewSelector(() => [videoEditRevision(), instance.frame, instance.inFrame, instance.outFrame], sameVideoEditViewFields)
  const sequence = getActiveVideoEditSequence(instance)
  const fps = sequence.fps
  const total = Math.max(1, videoEditDuration(sequence))
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // null = 整条序列；换序列时回到整条
  const [range, setRange] = useState<{ sequenceId: string; from: number; frames: number } | null>(null)
  const view = range && range.sequenceId === instance.activeSequenceId ? { from: Math.max(0, Math.min(range.from, total - Math.min(range.frames, total))), frames: Math.min(range.frames, total) } : { from: 0, frames: total }
  const inner = Math.max(1, width - RULER_INSET * 2)
  const pixels = inner / view.frames
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const measure = (): void => setWidth(element.clientWidth)
    measure()
    const Observer = ownerWindowOf(element).ResizeObserver
    const observer = typeof Observer === 'undefined' ? undefined : new Observer(measure)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])
  // 放大看一段时，播放头走出这一段就翻一页（PR）：正放把它放到左端，倒放放到右端，停着时居中
  const current = range && range.sequenceId === instance.activeSequenceId ? range : null
  const frame = Math.max(0, Math.min(total, instance.frame))
  const pagedFrom = !current || frame >= view.from && frame <= view.from + view.frames ? null
    : Math.max(0, Math.min(total - view.frames, frame - (!instance.playing ? view.frames / 2 : instance.playbackDirection < 0 ? view.frames : 0)))
  useEffect(() => {
    if (current && pagedFrom !== null && pagedFrom !== current.from) setRange({ ...current, from: pagedFrom })
  }, [current, pagedFrom])
  const frameAt = (clientX: number): number => {
    const left = host.current?.getBoundingClientRect().left ?? 0
    return Math.max(0, Math.min(total, Math.round(view.from + (clientX - left - RULER_INSET) / pixels)))
  }
  const seek = (clientX: number, scrubbing: boolean): void => {
    const frame = frameAt(clientX)
    setVideoEditView(instance.document.id, { frame, playing: false, scrubbing })
    if (scrubbing) requestVideoEditScrub(instance.document.id, { scope: 'program', kind: 'drag', seconds: frame / fps })
  }
  const ruler = timelineRulerScale(pixels, fps)
  const first = Math.floor(view.from / ruler.major); const last = Math.ceil((view.from + view.frames) / ruler.major)
  const minorPerMajor = ruler.minor ? Math.round(ruler.major / ruler.minor) : 0
  const x = (frame: number): number => RULER_INSET + (frame - view.from) * pixels
  const inFrame = instance.inFrame ?? 0; const outFrame = instance.outFrame ?? total
  const zoomTo = (from: number, to: number): void => {
    const frames = Math.max(MIN_VISIBLE_FRAMES, to - from)
    setRange(frames >= total ? null : { sequenceId: instance.activeSequenceId, from: Math.max(0, from), frames })
  }
  return <div className="shrink-0 select-none border-t border-line bg-panel" data-video-edit-program-ruler>
    <div ref={host} className="relative h-6 cursor-ew-resize overflow-hidden" role="slider" tabIndex={-1} aria-label="节目时间标尺" aria-valuemin={0} aria-valuemax={total} aria-valuenow={instance.frame}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        seek(event.clientX, false)
      }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) seek(event.clientX, true) }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) { event.currentTarget.releasePointerCapture(event.pointerId); seek(event.clientX, false) } }}
      onPointerCancel={() => setVideoEditView(instance.document.id, { scrubbing: false })}>
      {(instance.inFrame !== null || instance.outFrame !== null) && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 bg-selected-accent" data-video-edit-program-ruler-range style={{ left: x(inFrame), width: Math.max(1, (outFrame - inFrame) * pixels) }} />}
      {Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index).map(index => <span key={index} aria-hidden="true" className="pointer-events-none absolute bottom-0 top-1 whitespace-nowrap border-l border-line-strong pl-1 text-2xs leading-3 tabular-nums text-text3" style={{ left: x(index * ruler.major) }}>{timelineRulerLabel(index * ruler.major, fps, ruler.major, total)}</span>)}
      {minorPerMajor > 1 && Array.from({ length: Math.max(0, last - first) * minorPerMajor }, (_, index) => first * minorPerMajor + index).filter(index => index % minorPerMajor !== 0).map(index => <span key={`m${index}`} aria-hidden="true" className="pointer-events-none absolute bottom-0 h-1 border-l border-line" style={{ left: x(index * ruler.minor) }} />)}
      <div aria-hidden="true" data-video-edit-program-ruler-playhead className="pointer-events-none absolute inset-y-0 flex w-3 flex-col items-center" style={{ left: x(instance.frame) - 6 }}>
        <div className="h-2.5 w-3 shrink-0 bg-accent-ring" style={TIMELINE_PLAYHEAD_HEAD_SHAPE} />
        <div className="w-px flex-1 bg-accent-ring" />
      </div>
    </div>
    <div className="flex h-3.5 items-center" style={{ paddingInline: RULER_INSET - 4 }}>
      <VideoEditZoomBarTrack label="节目时间标尺缩放条" state={{ totalFrames: total, startFrame: view.from, visibleFrames: view.frames }} width={Math.max(1, inner)}
        onScroll={from => { if (current) setRange({ ...current, from }) }}
        onRange={zoomTo}
        onZoom={(center, factor) => { const frames = view.frames / factor; zoomTo(center - frames / 2, center + frames / 2) }} />
    </div>
  </div>
}
