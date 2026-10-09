import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

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
  dragBoundaryRef?: RefObject<HTMLElement | null>
  allowButtonTarget?: boolean
  /** 按下后移动多少像素才算开始拖动；默认 25 适合缩略图卡片，紧凑的行列表（行距小于 25）要传小值，否则拖到相邻一行永远不会开始拖动。 */
  dragThreshold?: number
  /** Equal-height virtual rows: resolve destinations from scroll offset, including unmounted rows. */
  virtualVertical?: boolean
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
    dragBoundaryRef,
    allowButtonTarget = false,
    dragThreshold = 25,
    virtualVertical = false,
    onReorder,
    onDragStateChange,
    onImageClick
  } = params
  const [dragState, setDragState] = useState<FilePreviewDragState>(INITIAL_DRAG_STATE)
  const dragStateRef = useRef(dragState)
  /** 本次拖动越过阈值后是否收到过移动（监听随回调变化会重建，不能放在闭包里）。 */
  const sawDragMoveRef = useRef(false)
  const dropTimer = useRef<ReturnType<typeof setTimeout>>()
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const originalScrollTopRef = useRef(0)
  // 拖拽开始那一刻（尚未有任何让位位移）缓存的原始几何，命中判定全程用这份快照而不是实时 rect。
  // 否则一旦目标项被视觉上让位位移过，它的实时 rect 已经偏离自己的原始槛位，
  // 鼠标往回拖时再也找不到"回到原位"的判定锚点，会出现只能单向让位、换不回去的问题。
  const originalRectsRef = useRef<Array<{
    left: number
    top: number
    width: number
    height: number
  } | null>>([])
  const dragBoundaryRectRef = useRef<{
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  } | null>(null)
  dragStateRef.current = dragState

  const resetDragState = useCallback(() => {
    clearTimeout(dropTimer.current)
    dropTimer.current = undefined
    dragStateRef.current = INITIAL_DRAG_STATE
    dragBoundaryRectRef.current = null
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
    const eventWindow = itemRefs.current[dragState.fromIndex ?? 0]?.ownerDocument.defaultView ?? window

    // 按鼠标位置求目标槛位；越过阈值后还没收到移动就松手（快速短距拖动，移动早于监听挂上）时按松手位置算。
    const update = (e: MouseEvent): void => {
      const from = dragStateRef.current.fromIndex
      const oldTo = dragStateRef.current.toIndex
      if (from === null || oldTo === null) return

      const draggingOriginal = originalRectsRef.current[from]
      if (!draggingOriginal) return
      // 用"原始位置 + 鼠标位移"算出拖拽项当前应在的中心点，不读它自己的实时 rect
      // （实时 rect 还要受调用方为视觉跟手施加的 transform、画布缩放等影响，换算麻烦还容易兜圈子）
      let currentX = e.clientX
      let currentY = e.clientY
      if (layout === 'vertical') {
        currentX = dragStateRef.current.startX
        const boundary = dragBoundaryRectRef.current
        if (boundary && boundary.height >= draggingOriginal.height) {
          const minCurrentY = dragStateRef.current.startY + boundary.top - draggingOriginal.top
          const maxCurrentY = dragStateRef.current.startY + boundary.bottom
            - (draggingOriginal.top + draggingOriginal.height)
          currentY = Math.min(Math.max(e.clientY, minCurrentY), maxCurrentY)
        }
      }

      const draggingCenterX = draggingOriginal.left
        + draggingOriginal.width / 2
        + (currentX - dragStateRef.current.startX)
      const draggingCenterY = draggingOriginal.top
        + draggingOriginal.height / 2
        + (currentY - dragStateRef.current.startY)

      let newToIndex = from
      let minDist = Infinity

      // 注意：这里不跳过 i === from。拖拽项自己的原始槛位也是一个候选目标——
      // 没有它，一旦换到别的位置，缺了"回到原位"这个候选，少于 3 项时就再也换不回去了。
      for (let i = 0; !virtualVertical && i < itemRefs.current.length; i += 1) {
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

      if (virtualVertical && layout === 'vertical' && draggingOriginal.height > 0) {
        const scrollDelta = (dragBoundaryRef?.current?.scrollTop ?? 0) - originalScrollTopRef.current
        newToIndex = Math.max(0, Math.min(files.length - 1,
          from + Math.round((currentY - dragStateRef.current.startY + scrollDelta) / draggingOriginal.height)))
        minDist = 0
      }

      const threshold = layout === 'grid'
        ? Math.max(draggingOriginal.width, draggingOriginal.height)
        : layout === 'vertical'
          ? draggingOriginal.height
          : 28
      const next = minDist < threshold && newToIndex !== oldTo
        ? { ...dragStateRef.current, currentX, currentY, toIndex: newToIndex }
        : { ...dragStateRef.current, currentX, currentY }
      dragStateRef.current = next
      setDragState(next)
    }
    let pointer: MouseEvent | undefined
    let scrollFrame: number | undefined
    const autoScroll = (): void => {
      const container = dragBoundaryRef?.current
      const boundary = dragBoundaryRectRef.current
      const height = originalRectsRef.current[dragState.fromIndex ?? 0]?.height ?? 0
      if (pointer && container && boundary && height > 0) {
        const direction = pointer.clientY < boundary.top + height ? -1
          : pointer.clientY > boundary.bottom - height ? 1 : 0
        if (direction) {
          const next = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + direction * height / 4))
          if (next !== container.scrollTop) { container.scrollTop = next; update(pointer) }
        }
      }
      scrollFrame = eventWindow.requestAnimationFrame(autoScroll)
    }
    const handleMouseMove = (e: MouseEvent) => { pointer = e; sawDragMoveRef.current = true; update(e) }
    if (virtualVertical) scrollFrame = eventWindow.requestAnimationFrame(autoScroll)

    const handleMouseUp = (e: MouseEvent) => {
      if (scrollFrame !== undefined) eventWindow.cancelAnimationFrame(scrollFrame)
      if (!sawDragMoveRef.current) update(e)
      const { fromIndex, toIndex } = dragStateRef.current
      if (fromIndex !== null && toIndex !== null && fromIndex !== toIndex) {
        setDragState((prev) => ({ ...prev, isDragging: false, isDropping: true }))
        dropTimer.current = setTimeout(() => {
          onReorder?.(fromIndex, toIndex)
          resetDragState()
        }, 150)
      } else {
        resetDragState()
      }
    }

    eventWindow.addEventListener('mousemove', handleMouseMove)
    eventWindow.addEventListener('mouseup', handleMouseUp)
    return () => {
      if (scrollFrame !== undefined) eventWindow.cancelAnimationFrame(scrollFrame)
      eventWindow.removeEventListener('mousemove', handleMouseMove)
      eventWindow.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragState.isDragging, dragState.fromIndex, layout, onReorder, resetDragState, virtualVertical, dragBoundaryRef, files.length])

  useEffect(() => {
    if (dragState.fromIndex === null) return
    const eventWindow = itemRefs.current[dragState.fromIndex]?.ownerDocument.defaultView ?? window
    const cancel = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); resetDragState()
    }
    eventWindow.addEventListener('keydown', cancel, true)
    return () => eventWindow.removeEventListener('keydown', cancel, true)
  }, [dragState.fromIndex, resetDragState])
  useEffect(() => () => { clearTimeout(dropTimer.current) }, [])
  useEffect(() => { if (disabled) resetDragState() }, [disabled, resetDragState])

  useEffect(() => {
    onDragStateChange?.(dragState.isDragging || dragState.isDropping)
  }, [dragState.isDragging, dragState.isDropping, onDragStateChange])

  useEffect(() => {
    if (dragState.fromIndex === null || dragState.isDragging || dragState.isDropping) return
    const eventWindow = itemRefs.current[dragState.fromIndex]?.ownerDocument.defaultView ?? window

    let moved = false
    const startX = dragState.startX
    const startY = dragState.startY

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = Math.abs(e.clientX - startX)
      const deltaY = Math.abs(e.clientY - startY)
      const crossedDragThreshold = layout === 'vertical'
        ? deltaY > dragThreshold
        : layout === 'horizontal'
          ? deltaX > dragThreshold
          : deltaX > dragThreshold || deltaY > dragThreshold
      if (crossedDragThreshold) {
        // 此刻还没有任何让位位移发生，是缓存"原始槛位"几何的唯一安全时机
        const measure = (element: HTMLDivElement | null) => {
          if (!element) return null
          const rect = element.getBoundingClientRect()
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        }
        if (virtualVertical) {
          originalRectsRef.current = []
          originalRectsRef.current[dragState.fromIndex!] = measure(itemRefs.current[dragState.fromIndex!] ?? null)
        } else originalRectsRef.current = itemRefs.current.map(measure)
        if (dragBoundaryRef?.current) {
          originalScrollTopRef.current = dragBoundaryRef.current.scrollTop
          const rect = dragBoundaryRef.current.getBoundingClientRect()
          dragBoundaryRectRef.current = {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          }
        } else {
          dragBoundaryRectRef.current = null
        }
        sawDragMoveRef.current = false
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
      eventWindow.removeEventListener('mousemove', handleMouseMove)
      eventWindow.removeEventListener('mouseup', handleMouseUp)
    }

    eventWindow.addEventListener('mousemove', handleMouseMove)
    eventWindow.addEventListener('mouseup', handleMouseUp)

    return () => {
      eventWindow.removeEventListener('mousemove', handleMouseMove)
      eventWindow.removeEventListener('mouseup', handleMouseUp)
    }
  }, [
    dragState.fromIndex,
    dragState.isDragging,
    dragState.isDropping,
    dragState.startX,
    dragState.startY,
    dragBoundaryRef,
    files,
    layout,
    dragThreshold,
    virtualVertical,
    onImageClick,
    resetDragState
  ])

  return {
    dragState,
    itemRefs,
    handleMouseDown
  }
}
