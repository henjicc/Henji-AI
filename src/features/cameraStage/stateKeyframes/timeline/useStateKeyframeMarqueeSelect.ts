import { useCallback, useRef, useState } from 'react'
import type { StageStateKeyframe } from '../../domain/stateKeyframeTypes'
import { timeToX } from '../../timeline/timeScale'

/** 框选命中容差（px）：允许框边缘擦到菱形一半就算选中，与菱形命中区半宽一致 */
const HIT_TOLERANCE_PX = 12
/** 位移阈值（px）：小于该值视为空白单击（清空选择），不进入框选 */
const DRAG_THRESHOLD_PX = 3

export interface StateKeyframeMarqueeRect {
  left: number
  top: number
  width: number
  height: number
}

interface MarqueeDragRef {
  pointerId: number
  startClientX: number
  startClientY: number
  startContentX: number
  moved: boolean
  ids: string[]
}

interface UseStateKeyframeMarqueeSelectOptions {
  containerRef: React.RefObject<HTMLDivElement>
  stateKeyframes: StageStateKeyframe[]
  pxPerSecond: number
  /** 松手提交选中集合；空白单击提交空数组（= 清空选择） */
  onCommit: (ids: string[]) => void
}

/**
 * 时间轴空白区域框选状态关键帧：在滚动容器上按下并拖出矩形，
 * 命中判断只看横向时间范围（关键帧都在同一行，纵向拖到轨道下方空白区也应能选中）。
 * 矩形用视口坐标绘制（fixed 定位），避免绝对定位子元素撑大滚动内容。
 */
export function useStateKeyframeMarqueeSelect({
  containerRef,
  stateKeyframes,
  pxPerSecond,
  onCommit,
}: UseStateKeyframeMarqueeSelectOptions): {
  rect: StateKeyframeMarqueeRect | null
  previewIds: string[] | null
  handlePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  handlePointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  handlePointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
  handlePointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void
} {
  const dragRef = useRef<MarqueeDragRef | null>(null)
  const [rect, setRect] = useState<StateKeyframeMarqueeRect | null>(null)
  const [previewIds, setPreviewIds] = useState<string[] | null>(null)

  const reset = useCallback((): void => {
    dragRef.current = null
    setRect(null)
    setPreviewIds(null)
  }, [])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const container = containerRef.current
    if (!container) return
    const target = event.target as Element
    // 交互元素与标尺各自有手势（点选/拖拽/scrub），只有真正的空白区域才启动框选
    if (target.closest('[role="button"],[data-panel-trigger-button],button,input,[data-timeline-ruler]')) return
    // 框选是自定义拖拽手势，禁止浏览器同时拉起原生文本选择。
    event.preventDefault()
    container.setPointerCapture(event.pointerId)
    const bounds = container.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startContentX: event.clientX - bounds.left + container.scrollLeft,
      moved: false,
      ids: [],
    }
  }, [containerRef])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    const container = containerRef.current
    if (!drag || !container || drag.pointerId !== event.pointerId) return
    if (!drag.moved) {
      const distance = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY)
      if (distance < DRAG_THRESHOLD_PX) return
      drag.moved = true
    }
    const bounds = container.getBoundingClientRect()
    const contentX = event.clientX - bounds.left + container.scrollLeft
    const minX = Math.min(drag.startContentX, contentX) - HIT_TOLERANCE_PX
    const maxX = Math.max(drag.startContentX, contentX) + HIT_TOLERANCE_PX
    const ids = stateKeyframes
      .filter((stateKeyframe) => {
        const x = timeToX(stateKeyframe.time, pxPerSecond)
        return x >= minX && x <= maxX
      })
      .map((stateKeyframe) => stateKeyframe.id)
    drag.ids = ids
    setPreviewIds(ids)
    setRect({
      left: Math.min(drag.startClientX, event.clientX),
      top: Math.min(drag.startClientY, event.clientY),
      width: Math.abs(event.clientX - drag.startClientX),
      height: Math.abs(event.clientY - drag.startClientY),
    })
  }, [containerRef, pxPerSecond, stateKeyframes])

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    containerRef.current?.releasePointerCapture?.(event.pointerId)
    onCommit(drag.moved ? drag.ids : [])
    reset()
  }, [containerRef, onCommit, reset])

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) reset()
  }, [reset])

  return { rect, previewIds, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel }
}
