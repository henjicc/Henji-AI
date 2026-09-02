import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

import {
  clampImageEditorDockWidthV3,
  resolveImageEditorDockSplitV3,
  type ImageEditorPanelDockEdgeV3,
} from './imageEditorPanelLayoutV3'

type DockResizeStateV3 = {
  kind: 'dock-width' | 'dock-split'
  edge: ImageEditorPanelDockEdgeV3
  pointerId: number
}

export function useImageEditorDockResizeV3(
  rootRef: RefObject<HTMLDivElement>,
) {
  const dockRefs = useRef<Record<ImageEditorPanelDockEdgeV3, HTMLElement | null>>({
    left: null,
    right: null,
  })
  const resizeRef = useRef<DockResizeStateV3 | null>(null)
  const [dockWidths, setDockWidths] = useState<Record<ImageEditorPanelDockEdgeV3, number>>({
    left: 400,
    right: 400,
  })
  const [dockSplits, setDockSplits] = useState<Record<ImageEditorPanelDockEdgeV3, number>>({
    left: 0.5,
    right: 0.5,
  })

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      const resize = resizeRef.current
      const root = rootRef.current
      if (!resize || resize.pointerId !== event.pointerId || !root) return
      if (resize.kind === 'dock-width') {
        const rootRect = root.getBoundingClientRect()
        const rawWidth = resize.edge === 'left'
          ? event.clientX - rootRect.left
          : rootRect.right - event.clientX
        setDockWidths((current) => ({
          ...current,
          [resize.edge]: clampImageEditorDockWidthV3(rawWidth, rootRect.width),
        }))
        return
      }
      const dockRect = dockRefs.current[resize.edge]?.getBoundingClientRect()
      if (!dockRect) return
      setDockSplits((current) => ({
        ...current,
        [resize.edge]: resolveImageEditorDockSplitV3(event.clientY, dockRect.top, dockRect.height),
      }))
    }
    const finishResize = (event: PointerEvent): void => {
      if (!resizeRef.current || resizeRef.current.pointerId !== event.pointerId) return
      resizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
      resizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [rootRef])

  const startResize = (
    kind: DockResizeStateV3['kind'],
    edge: ImageEditorPanelDockEdgeV3,
    event: ReactPointerEvent<HTMLElement>,
  ): void => {
    if (event.button !== 0 || !event.isPrimary || resizeRef.current) return
    resizeRef.current = { kind, edge, pointerId: event.pointerId }
    document.body.style.cursor = kind === 'dock-width' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    event.preventDefault()
    event.stopPropagation()
  }

  const adjustWidth = (edge: ImageEditorPanelDockEdgeV3, delta: number): void => {
    const viewportWidth = rootRef.current?.getBoundingClientRect().width ?? window.innerWidth
    setDockWidths((current) => ({
      ...current,
      [edge]: clampImageEditorDockWidthV3(current[edge] + delta, viewportWidth),
    }))
  }

  const adjustSplit = (edge: ImageEditorPanelDockEdgeV3, delta: number): void => {
    setDockSplits((current) => ({
      ...current,
      [edge]: Math.max(0.2, Math.min(0.8, current[edge] + delta)),
    }))
  }

  return { dockRefs, dockWidths, dockSplits, startResize, adjustWidth, adjustSplit }
}
