import { useCallback, useRef, type MouseEvent } from 'react'
import { useDragDrop } from '@/contexts/DragDropContext'

const DRAG_DISTANCE_THRESHOLD = 40
const DRAG_TIME_THRESHOLD = 150
const CONTEXT_MENU_COOLDOWN = 500

type DragType = 'image' | 'video'

interface DragPayload {
  type: DragType
  imageUrl: string
  filePath?: string
  sourceType: 'history'
}

interface UseHistoryDragResult {
  startImageDrag: (e: MouseEvent, imageUrl: string, filePath?: string) => void
  startVideoDrag: (e: MouseEvent, videoUrl: string, filePath?: string) => void
  shouldIgnoreClick: () => boolean
  markContextMenu: () => void
}

export function useHistoryDrag(): UseHistoryDragResult {
  const { startDrag } = useDragDrop()
  const isDraggingRef = useRef(false)
  const lastContextMenuTimeRef = useRef(0)

  const shouldIgnoreClick = useCallback((): boolean => {
    return isDraggingRef.current
  }, [])

  const markContextMenu = useCallback((): void => {
    lastContextMenuTimeRef.current = Date.now()
  }, [])

  const runDragWithThumbnail = useCallback((
    e: MouseEvent,
    payload: DragPayload,
    previewUrl: string,
    getThumbnail: (filePath: string, url: string) => Promise<{ filePath: string; dataUrl: string } | null>
  ): void => {
    if (e.button !== 0) return
    if (Date.now() - lastContextMenuTimeRef.current < CONTEXT_MENU_COOLDOWN) return

    e.preventDefault()
    const initialX = e.clientX
    const initialY = e.clientY
    const mouseDownTime = Date.now()

    let thumbnailPath: string | undefined
    let previewDataUrl = previewUrl

    if (payload.filePath) {
      void (async () => {
        const thumbnail = await getThumbnail(payload.filePath, previewUrl)
        if (thumbnail) {
          thumbnailPath = thumbnail.filePath
          previewDataUrl = thumbnail.dataUrl
        }
      })()
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = Math.abs(moveEvent.clientX - initialX)
      const deltaY = Math.abs(moveEvent.clientY - initialY)
      const timeSinceMouseDown = Date.now() - mouseDownTime
      if ((deltaX > DRAG_DISTANCE_THRESHOLD || deltaY > DRAG_DISTANCE_THRESHOLD) && timeSinceMouseDown > DRAG_TIME_THRESHOLD) {
        isDraggingRef.current = true
        startDrag(
          {
            ...payload,
            thumbnailPath,
          },
          previewDataUrl
        )
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      requestAnimationFrame(() => {
        isDraggingRef.current = false
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [startDrag])

  const loadImageThumbnail = useCallback(async (filePath: string, url: string) => {
    try {
      const { getOrCreateImageThumbnail } = await import('@/utils/imageConversion')
      return await getOrCreateImageThumbnail(filePath, url)
    } catch {
      return null
    }
  }, [])

  const loadVideoThumbnail = useCallback(async (filePath: string, url: string) => {
    try {
      const { getOrCreateVideoThumbnail } = await import('@/utils/imageConversion')
      return await getOrCreateVideoThumbnail(filePath, url)
    } catch {
      return null
    }
  }, [])

  const startImageDrag = useCallback((e: MouseEvent, imageUrl: string, filePath?: string): void => {
    runDragWithThumbnail(
      e,
      { type: 'image', imageUrl, filePath, sourceType: 'history' },
      imageUrl,
      loadImageThumbnail
    )
  }, [loadImageThumbnail, runDragWithThumbnail])

  const startVideoDrag = useCallback((e: MouseEvent, videoUrl: string, filePath?: string): void => {
    runDragWithThumbnail(
      e,
      { type: 'video', imageUrl: videoUrl, filePath, sourceType: 'history' },
      videoUrl,
      loadVideoThumbnail
    )
  }, [loadVideoThumbnail, runDragWithThumbnail])

  return {
    startImageDrag,
    startVideoDrag,
    shouldIgnoreClick,
    markContextMenu,
  }
}
