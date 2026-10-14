import { UI_PANEL_WIDTH } from '@/core/theme/panelSizes'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

export const ASSET_SIDEBAR_MIN_WIDTH = UI_PANEL_WIDTH.sidebar.min
export const ASSET_SIDEBAR_MAX_WIDTH = UI_PANEL_WIDTH.sidebar.max
export const ASSET_SIDEBAR_DEFAULT_WIDTH = UI_PANEL_WIDTH.sidebar.default

export function clampAssetSidebarWidth(width: number, viewportWidth: number): number {
  const viewportMax = Math.max(ASSET_SIDEBAR_MIN_WIDTH, Math.min(ASSET_SIDEBAR_MAX_WIDTH, viewportWidth * 0.3))
  return Math.round(Math.min(viewportMax, Math.max(ASSET_SIDEBAR_MIN_WIDTH, width)))
}

export function useAssetSidebarResize(): {
  width: number
  startResize: (event: PointerEvent<HTMLDivElement>) => void
  resizeByKeyboard: (event: KeyboardEvent<HTMLDivElement>) => void
} {
  // 记住用户拖出的宽度，只在显示时按视口夹紧：窗口缩小再放大后恢复原宽度。
  const [preferredWidth, setPreferredWidth] = useState<number>(ASSET_SIDEBAR_DEFAULT_WIDTH)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const width = clampAssetSidebarWidth(preferredWidth, viewportWidth)
  const widthRef = useRef(width)
  const resizingRef = useRef(false)
  const originRef = useRef<{ pointerX: number; width: number }>({ pointerX: 0, width: ASSET_SIDEBAR_DEFAULT_WIDTH })
  widthRef.current = width

  const handlePointerMove = useCallback((event: globalThis.PointerEvent): void => {
    if (!resizingRef.current) return
    setPreferredWidth(clampAssetSidebarWidth(originRef.current.width + event.clientX - originRef.current.pointerX, window.innerWidth))
  }, [])

  const stopResize = useCallback((): void => {
    if (!resizingRef.current) return
    resizingRef.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', stopResize)
    window.removeEventListener('pointercancel', stopResize)
  }, [handlePointerMove])

  const startResize = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    resizingRef.current = true
    originRef.current = { pointerX: event.clientX, width: widthRef.current }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }, [handlePointerMove, stopResize])

  const resizeByKeyboard = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setPreferredWidth(clampAssetSidebarWidth(widthRef.current + (event.key === 'ArrowRight' ? 16 : -16), window.innerWidth))
  }, [])

  useEffect(() => {
    const handleViewportResize = (): void => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleViewportResize)
    return () => {
      window.removeEventListener('resize', handleViewportResize)
      stopResize()
    }
  }, [stopResize])

  return { width, startResize, resizeByKeyboard }
}
