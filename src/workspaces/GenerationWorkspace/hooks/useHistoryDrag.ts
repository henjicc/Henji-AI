import { useCallback, useRef } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
import { useDragDrop } from '@/contexts/DragDropContext'
import { writeHenjiDragData } from '@/contexts/dragDataTransfer'
import { basename, toDisplaySrc } from '@/platform/desktopApi'
import { detectShell } from '@/platform/runtime'
import { inferMimeFromPath } from '@/utils/mime'

const DRAG_DISTANCE_THRESHOLD = 40
const DRAG_TIME_THRESHOLD = 150
const CONTEXT_MENU_COOLDOWN = 500
const BROWSER_DRAG_PREVIEW_SIZE = 64

type DragType = 'image' | 'video'

interface DragThumbnail {
  filePath: string
  displaySrc: string
  dataUrl?: string
}

let browserDragPreviewHost: HTMLDivElement | null = null

function getBrowserDragPreviewHost(): HTMLDivElement {
  if (browserDragPreviewHost) return browserDragPreviewHost

  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-9999px'
  host.style.top = '-9999px'
  host.style.width = `${BROWSER_DRAG_PREVIEW_SIZE}px`
  host.style.height = `${BROWSER_DRAG_PREVIEW_SIZE}px`
  host.style.pointerEvents = 'none'
  document.body.appendChild(host)
  browserDragPreviewHost = host
  return host
}

function setSmallBrowserDragPreview(e: ReactDragEvent, previewUrl?: string): void {
  if (!previewUrl) return

  const host = getBrowserDragPreviewHost()
  host.replaceChildren()

  const image = document.createElement('img')
  image.src = previewUrl
  image.draggable = false
  image.style.display = 'block'
  image.style.maxWidth = `${BROWSER_DRAG_PREVIEW_SIZE}px`
  image.style.maxHeight = `${BROWSER_DRAG_PREVIEW_SIZE}px`
  image.style.objectFit = 'contain'
  image.style.borderRadius = '8px'
  host.appendChild(image)

  e.dataTransfer.setDragImage(
    host,
    BROWSER_DRAG_PREVIEW_SIZE / 2,
    BROWSER_DRAG_PREVIEW_SIZE / 2
  )
}

function clearBrowserDragPreview(): void {
  browserDragPreviewHost?.replaceChildren()
}

function prepareNativeDragEvent(e: ReactDragEvent, payload: DragPayload, previewUrl?: string): void {
  try {
    e.dataTransfer.clearData()
    e.dataTransfer.setData('application/x-henji-native-file-drag', '1')
    writeHenjiDragData(e.dataTransfer, payload)
    setSmallBrowserDragPreview(e, previewUrl)
  } catch {
    // 某些拖拽数据源不允许清空；失败时仍继续走 Electron 原生拖拽。
  }
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.dropEffect = 'copy'
}

function tryStartDownloadUrlDrag(e: ReactDragEvent, payload: DragPayload, previewUrl?: string): boolean {
  if (!payload.filePath) {
    return false
  }

  try {
    e.dataTransfer.clearData()
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.dropEffect = 'copy'
    writeHenjiDragData(e.dataTransfer, payload)
    setSmallBrowserDragPreview(e, previewUrl)

    const fileName = basename(payload.filePath)
    const mime = inferMimeFromPath(payload.filePath)
    const downloadUrl = toDisplaySrc(payload.filePath.replace(/\\/g, '/'))
    e.dataTransfer.setData('DownloadURL', `${mime}:${fileName}:${downloadUrl}`)
    return true
  } catch {
    return false
  }
}

interface DragPayload {
  type: DragType
  imageUrl: string
  filePath?: string
  sourceType: 'history'
}

interface UseHistoryDragResult {
  startImageDrag: (e: ReactMouseEvent, imageUrl: string, filePath?: string) => void
  startVideoDrag: (e: ReactMouseEvent, videoUrl: string, filePath?: string) => void
  startImageNativeDrag: (e: ReactDragEvent, imageUrl: string, filePath?: string) => void
  startVideoNativeDrag: (e: ReactDragEvent, videoUrl: string, filePath?: string) => void
  endNativeDrag: () => void
  isNativeFileDragEnabled: boolean
  shouldIgnoreClick: () => boolean
  markContextMenu: () => void
}

export function useHistoryDrag(): UseHistoryDragResult {
  const { startDrag, startNativeDrag, endDrag } = useDragDrop()
  const isNativeFileDragEnabled = detectShell() === 'electron'
  const isDraggingRef = useRef(false)
  const nativeDragActiveRef = useRef(false)
  const nativeDragCleanupRef = useRef<(() => void) | null>(null)
  const mouseDragCleanupRef = useRef<(() => void) | null>(null)
  const lastContextMenuTimeRef = useRef(0)
  const thumbnailCacheRef = useRef(new Map<string, DragThumbnail>())

  const shouldIgnoreClick = useCallback((): boolean => {
    return isDraggingRef.current
  }, [])

  const markContextMenu = useCallback((): void => {
    lastContextMenuTimeRef.current = Date.now()
  }, [])

  const runDragWithThumbnail = useCallback((
    e: ReactMouseEvent,
    payload: DragPayload,
    previewUrl: string,
    getThumbnail: (filePath: string, url: string) => Promise<DragThumbnail | null>
  ): void => {
    if (e.button !== 0) return
    if (Date.now() - lastContextMenuTimeRef.current < CONTEXT_MENU_COOLDOWN) return

    const shouldAllowNativeDragStart = isNativeFileDragEnabled && Boolean(payload.filePath)
    if (!shouldAllowNativeDragStart) {
      e.preventDefault()
    }
    const initialX = e.clientX
    const initialY = e.clientY
    const mouseDownTime = Date.now()

    let thumbnailPath: string | undefined
    let previewDataUrl = previewUrl

    const payloadFilePath = payload.filePath
    const cleanupMouseTracking = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      if (mouseDragCleanupRef.current === cleanupMouseTracking) {
        mouseDragCleanupRef.current = null
      }
    }

    if (payloadFilePath) {
      void (async () => {
        const thumbnail = await getThumbnail(payloadFilePath, previewUrl)
        if (thumbnail) {
          thumbnailPath = thumbnail.filePath
          previewDataUrl = thumbnail.displaySrc
          thumbnailCacheRef.current.set(payloadFilePath, thumbnail)
        }
      })()
    }

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      if (nativeDragActiveRef.current) {
        cleanupMouseTracking()
        return
      }
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
        cleanupMouseTracking()
      }
    }

    const handleMouseUp = () => {
      cleanupMouseTracking()
      requestAnimationFrame(() => {
        isDraggingRef.current = false
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    mouseDragCleanupRef.current = cleanupMouseTracking
  }, [isNativeFileDragEnabled, startDrag])

  const cleanupNativeDrag = useCallback((): void => {
    nativeDragCleanupRef.current?.()
    nativeDragCleanupRef.current = null
    mouseDragCleanupRef.current?.()
    mouseDragCleanupRef.current = null
    nativeDragActiveRef.current = false
    clearBrowserDragPreview()
    endDrag()
    requestAnimationFrame(() => {
      isDraggingRef.current = false
    })
  }, [endDrag])

  const armNativeDragCleanup = useCallback((): void => {
    nativeDragCleanupRef.current?.()

    const cleanup = () => {
      nativeDragCleanupRef.current?.()
      nativeDragCleanupRef.current = null
      cleanupNativeDrag()
    }

    window.addEventListener('dragend', cleanup, true)
    window.addEventListener('drop', cleanup, true)
    window.addEventListener('mouseup', cleanup, true)
    window.addEventListener('blur', cleanup, true)

    nativeDragCleanupRef.current = () => {
      window.removeEventListener('dragend', cleanup, true)
      window.removeEventListener('drop', cleanup, true)
      window.removeEventListener('mouseup', cleanup, true)
      window.removeEventListener('blur', cleanup, true)
    }
  }, [cleanupNativeDrag])

  const runNativeDrag = useCallback((
    e: ReactDragEvent,
    payload: DragPayload
  ): void => {
    if (!isNativeFileDragEnabled || !payload.filePath) return

    mouseDragCleanupRef.current?.()
    mouseDragCleanupRef.current = null

    const thumbnail = thumbnailCacheRef.current.get(payload.filePath)
    const previewUrl = thumbnail?.displaySrc ?? (payload.type === 'image' ? payload.imageUrl : undefined)
    endDrag()
    armNativeDragCleanup()

    if (tryStartDownloadUrlDrag(e, payload, previewUrl)) {
      e.stopPropagation()
      nativeDragActiveRef.current = true
      isDraggingRef.current = true
      return
    }

    prepareNativeDragEvent(e, payload, previewUrl)
    e.preventDefault()
    e.stopPropagation()
    nativeDragActiveRef.current = true
    isDraggingRef.current = true

    startNativeDrag({
      ...payload,
      thumbnailPath: thumbnail?.filePath,
    })
  }, [armNativeDragCleanup, endDrag, isNativeFileDragEnabled, startNativeDrag])

  const endNativeDrag = useCallback((): void => {
    cleanupNativeDrag()
  }, [cleanupNativeDrag])

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

  const startImageDrag = useCallback((e: ReactMouseEvent, imageUrl: string, filePath?: string): void => {
    runDragWithThumbnail(
      e,
      { type: 'image', imageUrl, filePath, sourceType: 'history' },
      imageUrl,
      loadImageThumbnail
    )
  }, [loadImageThumbnail, runDragWithThumbnail])

  const startVideoDrag = useCallback((e: ReactMouseEvent, videoUrl: string, filePath?: string): void => {
    runDragWithThumbnail(
      e,
      { type: 'video', imageUrl: videoUrl, filePath, sourceType: 'history' },
      videoUrl,
      loadVideoThumbnail
    )
  }, [loadVideoThumbnail, runDragWithThumbnail])

  const startImageNativeDrag = useCallback((e: ReactDragEvent, imageUrl: string, filePath?: string): void => {
    runNativeDrag(e, { type: 'image', imageUrl, filePath, sourceType: 'history' })
  }, [runNativeDrag])

  const startVideoNativeDrag = useCallback((e: ReactDragEvent, videoUrl: string, filePath?: string): void => {
    runNativeDrag(e, { type: 'video', imageUrl: videoUrl, filePath, sourceType: 'history' })
  }, [runNativeDrag])

  return {
    startImageDrag,
    startVideoDrag,
    startImageNativeDrag,
    startVideoNativeDrag,
    endNativeDrag,
    isNativeFileDragEnabled,
    shouldIgnoreClick,
    markContextMenu,
  }
}
