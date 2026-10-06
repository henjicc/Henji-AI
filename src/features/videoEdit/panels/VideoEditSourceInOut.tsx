import { useRef } from 'react'

type Handle = 'in' | 'out' | 'move'
interface Props { inUs: number | null; outUs: number | null; durationUs: number; playheadUs: number; onChange: (values: { inUs?: number | null; outUs?: number | null }) => void }
/** 入出点之间至少留的长度（1 毫秒），与源入出点“出点晚于入点”的校验对应。 */
const MIN_SPAN_US = 1000
const SNAP_PIXELS = 6

/**
 * 源监视器进度条上的入出点区间（与时间线标尺的序列入出点同一种操作）：入点到出点一条浅色条，只设了一端时延到素材开头或结尾。
 * 拖两端改入点／出点，拖中间整体平移，靠近播放头时吸上。入出点是源监视器的查看状态，不进撤销。
 */
export function VideoEditSourceInOut({ inUs, outUs, durationUs, playheadUs, onChange }: Props): React.ReactElement | null {
  const drag = useRef<{ handle: Handle; pointerId: number; x: number; width: number; inUs: number | null; outUs: number | null } | null>(null)
  if ((inUs === null && outUs === null) || durationUs <= 0) return null
  const from = inUs ?? 0
  const to = outUs ?? durationUs
  const start = (event: React.PointerEvent<HTMLElement>, handle: Handle): void => {
    if (event.button !== 0) return
    // 不让进度条把这次按下当成定位
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const track = event.currentTarget.closest<HTMLElement>('[data-video-edit-source-progress]')
    drag.current = { handle, pointerId: event.pointerId, x: event.clientX, width: Math.max(1, track?.getBoundingClientRect().width ?? 1), inUs, outUs }
  }
  const move = (event: React.PointerEvent<HTMLElement>): void => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    event.stopPropagation()
    const perPixel = durationUs / state.width
    let delta = Math.round((event.clientX - state.x) * perPixel)
    const baseIn = state.inUs ?? 0; const baseOut = state.outUs ?? durationUs
    // 吸附到播放头：拖动的那一端（整体平移时两端都算）离播放头不到几个像素就对齐
    const edges = state.handle === 'in' ? [baseIn] : state.handle === 'out' ? [baseOut] : [baseIn, baseOut]
    const snap = edges.map(edge => playheadUs - (edge + delta)).filter(gap => Math.abs(gap) <= SNAP_PIXELS * perPixel).sort((a, b) => Math.abs(a) - Math.abs(b))[0]
    if (snap !== undefined) delta += snap
    if (state.handle === 'in') onChange({ inUs: Math.max(0, Math.min(baseOut - MIN_SPAN_US, baseIn + delta)) })
    else if (state.handle === 'out') onChange({ outUs: Math.max(baseIn + MIN_SPAN_US, Math.min(durationUs, baseOut + delta)) })
    else {
      const shift = Math.max(-baseIn, Math.min(durationUs - baseOut, delta))
      onChange({ ...(state.inUs !== null ? { inUs: baseIn + shift } : {}), ...(state.outUs !== null ? { outUs: baseOut + shift } : {}) })
    }
  }
  const end = (event: React.PointerEvent<HTMLElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) return
    event.stopPropagation()
    drag.current = null
  }
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end }
  return <div data-video-edit-source-in-out={`${from}-${to}`} title="源入点到出点：拖两端调整，拖中间整体移动"
    className="absolute bottom-0 z-raised h-1.5 cursor-grab bg-text1/15 hover:bg-text1/25" style={{ left: `${from / durationUs * 100}%`, width: `max(2px, ${(to - from) / durationUs * 100}%)` }}
    onPointerDown={event => start(event, 'move')} {...handlers}>
    <div aria-label="拖动调整源入点" className="absolute -left-1 bottom-0 top-0 w-2 cursor-ew-resize" onPointerDown={event => start(event, 'in')} {...handlers} />
    <div aria-label="拖动调整源出点" className="absolute -right-1 bottom-0 top-0 w-2 cursor-ew-resize" onPointerDown={event => start(event, 'out')} {...handlers} />
  </div>
}
