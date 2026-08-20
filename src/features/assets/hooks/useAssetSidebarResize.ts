import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

export const ASSET_SIDEBAR_MIN_WIDTH = 184
export const ASSET_SIDEBAR_MAX_WIDTH = 360
export const ASSET_SIDEBAR_DEFAULT_WIDTH = 232

export function clampAssetSidebarWidth(width: number, viewportWidth: number): number {
  const viewportMax = Math.max(ASSET_SIDEBAR_MIN_WIDTH, Math.min(ASSET_SIDEBAR_MAX_WIDTH, viewportWidth * 0.3))
  return Math.round(Math.min(viewportMax, Math.max(ASSET_SIDEBAR_MIN_WIDTH, width)))
}

export function useAssetSidebarResize(): {
  width: number
  startResize: (event: PointerEvent<HTMLDivElement>) => void
  resizeByKeyboard: (event: KeyboardEvent<HTMLDivElement>) => void
} {
  const [width, setWidth] = useState(() => clampAssetSidebarWidth(ASSET_SIDEBAR_DEFAULT_WIDTH, window.innerWidth))
  const widthRef = useRef(width)
  const resizingRef = useRef(false)
  const originRef = useRef({ pointerX: 0, width: ASSET_SIDEBAR_DEFAULT_WIDTH })
  widthRef.current = width

  const handlePointerMove = useCallback((event: globalThis.PointerEvent): void => {
    if (!resizingRef.current) return
    setWidth(clampAssetSidebarWidth(originRef.current.width + event.clientX - originRef.current.pointerX, window.innerWidth))
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
    setWidth((current) => clampAssetSidebarWidth(current + (event.key === 'ArrowRight' ? 16 : -16), window.innerWidth))
  }, [])

  useEffect(() => {
    const handleViewportResize = (): void => setWidth((current) => clampAssetSidebarWidth(current, window.innerWidth))
    window.addEventListener('resize', handleViewportResize)
    return () => {
      window.removeEventListener('resize', handleViewportResize)
      stopResize()
    }
  }, [stopResize])

  return { width, startResize, resizeByKeyboard }
}
