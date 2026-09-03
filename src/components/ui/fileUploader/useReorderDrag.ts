import { useCallback, useEffect, useRef, useState } from 'react'

export interface FilePreviewDragState {
  isDragging: boolean
  isDropping: boolean
  fromIndex: number | null
  toIndex: number | null
  startX: number
  startY: number
  currentX: number
  currentY: number
}

interface UseReorderDragParams {
  disabled: boolean
  isCustomDragging: boolean
  files: string[]
  layout?: 'horizontal' | 'vertical' | 'grid'
  allowButtonTarget?: boolean
  onReorder?: (from: number, to: number) => void
  onDragStateChange?: (isDragging: boolean) => void
  onImageClick?: (imageUrl: string, imageList: string[]) => void
}

const INITIAL_DRAG_STATE: FilePreviewDragState = {
  isDragging: false,
  isDropping: false,
  fromIndex: null,
  toIndex: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0
}

export function useReorderDrag(params: UseReorderDragParams) {
  const {
    disabled,
    isCustomDragging,
    files,
    layout = 'horizontal',
    allowButtonTarget = false,
    onReorder,
    onDragStateChange,
    onImageClick
  } = params
  const [dragState, setDragState] = useState<FilePreviewDragState>(INITIAL_DRAG_STATE)
  const dragStateRef = useRef(dragState)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  // 拖拽开始那一刻（尚未有任何让位位移）缓存的原始几何，命中判定全程用这份快照而不是实时 rect。
  // 否则一旦目标项被视觉上让位位移过，它的实时 rect 已经偏离自己的原始槛位，
  // 鼠标往回拖时再也找不到"回到原位"的判定锚点，会出现只能单向让位、换不回去的问题。
  const originalRectsRef = useRef<Array<{
    left: number
    top: number
    width: number
    height: number
  } | null>>([])
  dragStateRef.current = dragState

  const resetDragState = useCallback(() => {
    setDragState(INITIAL_DRAG_STATE)
  }, [])

  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (!allowButtonTarget && (target.tagName === 'BUTTON' || target.closest('button'))) {
      e.preventDefault()
      return
    }

    if (disabled || isCustomDragging || e.button !== 0) return
    e.preventDefault()
    setDragState({
      isDragging: false,
      isDropping: false,
      fromIndex: index,
      toIndex: index,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY
    })
  }, [allowButtonTarget, disabled, isCustomDragging])

  useEffect(() => {
    if (!dragState.isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const from = dragStateRef.current.fromIndex
      const oldTo = dragStateRef.current.toIndex
      if (from === null || oldTo === null) return

      const draggingOriginal = originalRectsRef.current[from]
      if (!draggingOriginal) return
      // 用"原始位置 + 鼠标位移"算出拖拽项当前应在的中心点，不读它自己的实时 rect
      // （实时 rect 还要受调用方为视觉跟手施加的 transform、画布缩放等影响，换算麻烦还容易兜圈子）
      const draggingCenterX =
        draggingOriginal.left + draggingOriginal.width / 2 + (e.clientX - dragStateRef.current.startX)
      const draggingCenterY =
        draggingOriginal.top + draggingOriginal.height / 2 + (e.clientY - dragStateRef.current.startY)

      let newToIndex = from
      let minDist = Infinity

      // 注意：这里不跳过 i === from。拖拽项自己的原始槛位也是一个候选目标——
      // 没有它，一旦换到别的位置，缺了"回到原位"这个候选，少于 3 项时就再也换不回去了。
      for (let i = 0; i < itemRefs.current.length; i += 1) {
        const rect = originalRectsRef.current[i]
        if (!rect) continue
        const targetCenterX = rect.left + rect.width / 2
        const targetCenterY = rect.top + rect.height / 2
        const dist = layout === 'grid'
          ? Math.hypot(draggingCenterX - targetCenterX, draggingCenterY - targetCenterY)
          : layout === 'vertical'
            ? Math.abs(draggingCenterY - targetCenterY)
            : Math.abs(draggingCenterX - targetCenterX)
        if (dist < minDist) {
          minDist = dist
          newToIndex = i
        }
      }

      const threshold = layout === 'grid'
        ? Math.max(draggingOriginal.width, draggingOriginal.height)
        : layout === 'vertical'
          ? draggingOriginal.height
          : 28
      if (minDist < threshold && newToIndex !== oldTo) {
        setDragState({
          ...dragStateRef.current,
          currentX: e.clientX,
          currentY: e.clientY,
          toIndex: newToIndex
        })
      } else {
        setDragState({
          ...dragStateRef.current,
          currentX: e.clientX,
          currentY: e.clientY
        })
      }
    }

    const handleMouseUp = () => {
      const { fromIndex, toIndex } = dragStateRef.current
      if (fromIndex !== null && toIndex !== null && fromIndex !== toIndex) {
        setDragState((prev) => ({ ...prev, isDragging: false, isDropping: true }))
        setTimeout(() => {
          onReorder?.(fromIndex, toIndex)
          resetDragState()
        }, 150)
      } else {
        resetDragState()
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragState.isDragging, layout, onReorder, resetDragState])

  useEffect(() => {
    onDragStateChange?.(dragState.isDragging || dragState.isDropping)
  }, [dragState.isDragging, dragState.isDropping, onDragStateChange])

  useEffect(() => {
    if (dragState.fromIndex === null || dragState.isDragging || dragState.isDropping) return

    let moved = false
    const startX = dragState.startX
    const startY = dragState.startY

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = Math.abs(e.clientX - startX)
      const deltaY = Math.abs(e.clientY - startY)
      if (deltaX > 25 || deltaY > 25) {
        // 此刻还没有任何让位位移发生，是缓存"原始槛位"几何的唯一安全时机
        originalRectsRef.current = itemRefs.current.map((el) =>
          el ? (() => {
            const rect = el.getBoundingClientRect()
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          })() : null
        )
        setDragState((prev) => ({ ...prev, isDragging: true }))
        moved = true
      }
    }

    const handleMouseUp = () => {
      if (!moved) {
        const clickedIndex = dragState.fromIndex
        if (clickedIndex !== null && onImageClick) {
          onImageClick(files[clickedIndex], files)
        }
        resetDragState()
      }
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [
    dragState.fromIndex,
    dragState.isDragging,
    dragState.isDropping,
    dragState.startX,
    dragState.startY,
    files,
    onImageClick,
    resetDragState
  ])

  return {
    dragState,
    itemRefs,
    handleMouseDown
  }
}
