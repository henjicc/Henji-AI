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
  const { disabled, isCustomDragging, files, onReorder, onDragStateChange, onImageClick } = params
  const [dragState, setDragState] = useState<FilePreviewDragState>(INITIAL_DRAG_STATE)
  const dragStateRef = useRef(dragState)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  dragStateRef.current = dragState

  const resetDragState = useCallback(() => {
    setDragState(INITIAL_DRAG_STATE)
  }, [])

  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'BUTTON' || target.closest('button')) {
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
  }, [disabled, isCustomDragging])

  useEffect(() => {
    if (!dragState.isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const from = dragStateRef.current.fromIndex
      const oldTo = dragStateRef.current.toIndex
      if (from === null || oldTo === null) return

      let newToIndex = from
      let minDist = Infinity
      const draggingEl = itemRefs.current[from]
      if (!draggingEl) return

      const draggingRect = draggingEl.getBoundingClientRect()
      const draggingCenterX = draggingRect.left + draggingRect.width / 2

      for (let i = 0; i < itemRefs.current.length; i += 1) {
        if (i === from) continue
        const el = itemRefs.current[i]
        if (!el) continue
        const rect = el.getBoundingClientRect()
        const targetCenterX = rect.left + rect.width / 2
        const dist = Math.abs(draggingCenterX - targetCenterX)
        if (dist < minDist) {
          minDist = dist
          newToIndex = i
        }
      }

      const threshold = 28
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
  }, [dragState.isDragging, onReorder, resetDragState])

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
