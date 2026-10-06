import { TIMELINE_HEADER_WIDTH } from './timelineGeometry'
import { timelineZoomBarCenterAt, timelineZoomBarDrag, timelineZoomBarThumb, type TimelineZoomBarPart, type TimelineZoomBarState } from './timelineZoomBar'

interface Props {
  state: TimelineZoomBarState
  /** 条的可用像素宽度（轨道区宽度减去两侧留白）。 */
  width: number
  /** 平移：可见范围从 `frame` 开始（缩放不变）。 */
  onScroll: (frame: number) => void
  /** 拖两端：让 `[from, to)` 铺满可见宽度。 */
  onRange: (from: number, to: number) => void
  /** 滚轮：以可见范围中间为准按倍数缩放。 */
  onZoom: (frame: number, factor: number) => void
}

/**
 * PR 时间线底部的缩放滚动条：与轨道区左缘对齐，滑块两端各有一个圆形手柄。
 * 拖中间平移、拖两端缩放、在条上滚滚轮缩放、单击空白处跳到那里。取代原生横向滚动条。
 */
export function VideoEditTimelineZoomBar({ state, width, onScroll, onRange, onZoom }: Props): React.ReactElement {
  const thumb = timelineZoomBarThumb(state, width)
  const begin = (event: React.PointerEvent<HTMLElement>, part: TimelineZoomBarPart): void => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    const target = event.currentTarget; const origin = event.clientX; const start = { ...state }
    target.setPointerCapture?.(event.pointerId)
    const move = (next: PointerEvent): void => {
      const range = timelineZoomBarDrag(start, part, next.clientX - origin, width)
      if (part === 'move') onScroll(range.from)
      else onRange(range.from, range.to)
    }
    const end = (): void => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end) }
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end)
  }
  return <div className="flex h-3.5 shrink-0 items-center border-t border-gap bg-panel" data-video-edit-zoom-bar style={{ paddingLeft: TIMELINE_HEADER_WIDTH }}>
    <div className="relative mx-1 h-full flex-1" role="scrollbar" aria-orientation="horizontal" aria-label="时间线缩放滚动条" aria-valuemin={0} aria-valuemax={Math.round(state.totalFrames)} aria-valuenow={Math.round(state.startFrame)}
      onPointerDown={event => { if (event.button === 0 && event.target === event.currentTarget) onScroll(timelineZoomBarCenterAt(state, event.clientX - event.currentTarget.getBoundingClientRect().left, width)) }}
      onWheel={event => { if (event.deltaY) onZoom(state.startFrame + state.visibleFrames / 2, event.deltaY < 0 ? 1.25 : 0.8) }}>
      <div className="group absolute top-1/2 flex h-2.5 -translate-y-1/2 items-center rounded-full bg-text2/30 hover:bg-text2/45" style={{ left: thumb.left, width: thumb.width }} data-video-edit-zoom-thumb
        title="拖动平移，拖两端缩放" onPointerDown={event => begin(event, 'move')}>
        <span data-video-edit-zoom-handle="start" aria-label="拖动调整可见范围起点" className="h-2.5 w-2.5 shrink-0 cursor-ew-resize rounded-full bg-text2" onPointerDown={event => begin(event, 'start')} />
        <span className="flex-1" />
        <span data-video-edit-zoom-handle="end" aria-label="拖动调整可见范围终点" className="h-2.5 w-2.5 shrink-0 cursor-ew-resize rounded-full bg-text2" onPointerDown={event => begin(event, 'end')} />
      </div>
    </div>
  </div>
}
