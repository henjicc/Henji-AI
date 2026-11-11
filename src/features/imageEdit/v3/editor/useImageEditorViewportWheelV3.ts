import { useEffect, type RefObject } from 'react'

import { wheelZoomFactor } from '@/core/viewport/zoomPan'

import type { ImageEditorToolIdV3 } from '../application/imageEditorHostProfiles'

export function useImageEditorViewportWheelV3(
  surfaceRef: RefObject<HTMLElement>,
  activeTool: ImageEditorToolIdV3,
  zoom: number,
  zoomAroundClientPoint: (clientX: number, clientY: number, requestedZoom: number) => void,
): void {
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const handleWheel = (event: WheelEvent): void => {
      if (activeTool !== 'zoom' && !event.ctrlKey && !event.metaKey) return
      if (event.deltaY === 0) return
      event.preventDefault()
      zoomAroundClientPoint(event.clientX, event.clientY, zoom * wheelZoomFactor(event.deltaY))
    }
    surface.addEventListener('wheel', handleWheel, { passive: false })
    return () => surface.removeEventListener('wheel', handleWheel)
  }, [activeTool, surfaceRef, zoom, zoomAroundClientPoint])
}
