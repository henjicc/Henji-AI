import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.cameraStage.simple')

/** 拖拽超过该阈值（px）才判定为重排拖拽，否则在 pointerup 时按点击处理（选卡） */
const DRAG_THRESHOLD_PX = 4

export interface ClipReorderStaticBlock {
  shotId: string
  x: number
  width: number
}

interface ClipReorderMidpoint {
  shotId: string
  centerX: number
}

/**
 * 按「排除被拖块自身」的静止块中线位置计算目标插入下标（可直接传给 `reorderShot(id, toIndex)`，
 * 语义与 store 一致：下标是移除被拖块后的数组位置）。纯函数，便于单测覆盖边界情况。
 */
export function computeInsertIndex(midpoints: ClipReorderMidpoint[], pointerX: number): number {
  for (let index = 0; index < midpoints.length; index += 1) {
    if (pointerX < midpoints[index].centerX) return index
  }
  return midpoints.length
}

export interface ClipReorderDragState {
  shotId: string
  /** 被拖块相对起点的水平位移（px），供视觉跟手 transform 使用 */
  offsetX: number
  /** 当前插入下标，供插入指示线定位 */
  insertIndex: number
}

interface ClipReorderDragRef {
  shotId: string
  pointerId: number
  startClientX: number
  fromIndex: number
  moved: boolean
  insertIndex: number
}

interface UseClipReorderOptions {
  /** 当前静止块布局（按 shots 数组顺序排列，元素数量等于静止块数量） */
  staticBlocks: ClipReorderStaticBlock[]
  /** 轨道内容容器（几何原点），用于把 clientX 换算为轨道内本地坐标 */
  trackRef: React.RefObject<HTMLDivElement>
  onReorder: (shotId: string, toIndex: number) => void
  onSelect: (shotId: string) => void
}

interface UseClipReorderResult {
  drag: ClipReorderDragState | null
  beginReorder: (event: React.PointerEvent, shotId: string) => void
  handlePointerMove: (event: React.PointerEvent) => void
  handlePointerUp: (event: React.PointerEvent) => void
  handlePointerCancel: (event: React.PointerEvent) => void
}

/**
 * 变宽块重排 hook：pointerdown 记录起点 → 超过阈值判定为拖拽（半透明跟随指针水平移动，
 * 按指针 x 与各静止块中线比较算出目标插入下标）→ pointerup 一次性提交 `onReorder`；
 * 未超过阈值则视为点击，走 `onSelect`。Escape 取消。过渡块不接入本 hook（跟随前面的静止卡移动）。
 */
export function useClipReorder({ staticBlocks, trackRef, onReorder, onSelect }: UseClipReorderOptions): UseClipReorderResult {
  const [drag, setDrag] = useState<ClipReorderDragState | null>(null)
  const dragRef = useRef<ClipReorderDragRef | null>(null)

  const cancelDrag = useCallback((): void => {
    dragRef.current = null
    setDrag(null)
  }, [])

  useEffect(() => {
    if (!drag) return undefined
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelDrag()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [drag, cancelDrag])

  const beginReorder = useCallback((event: React.PointerEvent, shotId: string): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const fromIndex = staticBlocks.findIndex((block) => block.shotId === shotId)
    dragRef.current = {
      shotId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      fromIndex,
      moved: false,
      insertIndex: fromIndex,
    }
  }, [staticBlocks])

  const handlePointerMove = useCallback((event: React.PointerEvent): void => {
    const state = dragRef.current
    if (!state || event.pointerId !== state.pointerId) return
    const deltaX = event.clientX - state.startClientX
    if (!state.moved && Math.abs(deltaX) < DRAG_THRESHOLD_PX) return
    state.moved = true
    const rect = trackRef.current?.getBoundingClientRect()
    const pointerX = rect ? event.clientX - rect.left : 0
    const midpoints = staticBlocks
      .filter((block) => block.shotId !== state.shotId)
      .map((block) => ({ shotId: block.shotId, centerX: block.x + block.width / 2 }))
    const insertIndex = computeInsertIndex(midpoints, pointerX)
    state.insertIndex = insertIndex
    setDrag({ shotId: state.shotId, offsetX: deltaX, insertIndex })
  }, [staticBlocks, trackRef])

  const handlePointerUp = useCallback((event: React.PointerEvent): void => {
    const state = dragRef.current
    if (!state || event.pointerId !== state.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (state.moved) {
      if (state.insertIndex !== state.fromIndex) {
        onReorder(state.shotId, state.insertIndex)
        logger.debug('拖拽重排镜头卡', {
          event: 'simple_mode.shot.reordered',
          shotId: state.shotId,
          fromIndex: state.fromIndex,
          toIndex: state.insertIndex,
        })
      }
    } else {
      onSelect(state.shotId)
    }
    dragRef.current = null
    setDrag(null)
  }, [onReorder, onSelect])

  const handlePointerCancel = useCallback((event: React.PointerEvent): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    cancelDrag()
  }, [cancelDrag])

  return { drag, beginReorder, handlePointerMove, handlePointerUp, handlePointerCancel }
}
