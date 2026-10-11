import { useEffect, useRef, type RefObject } from 'react'
import { getPlatform } from '@/platform/runtime'
import { SURFACE_OBSERVATION_SCHEMA_VERSION } from '@/core/application-control/surfaceObservation'
import { imageEditExplanation } from '../application/imageEditExplanation'
import { imageEditV3LayerRef } from '../application/imageEditDocumentRefs'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import type { ImageEditorV3Controller } from './types'
import type { ImageEditorViewportLayoutV3 } from './useImageEditorViewportLayoutV3'
import { pickImageEditorLayerV3, type LayerAlphaMapsV3 } from './layerPickingV3'
import { findImageEditLayerLocationV3 } from './layerTreeV3'
import { resolveAnnotationOutputGeometryV3 } from './annotationGeometryV3'
import { composeAffine, inverseAffine, mapAffine } from '@/core/imaging/transforms'

/** Only the mounted, acknowledged preview can supply pointing geometry. */
export function useImageEditorExplanationV3(input: {
  bus: ImageEditCommandBusV3; controller: ImageEditorV3Controller; surface: RefObject<HTMLElement | null>
  layout: ImageEditorViewportLayoutV3 | null; maps: LayerAlphaMapsV3; selected: readonly string[]; ready: boolean
}): void {
  const latest = useRef(input); latest.current = input
  useEffect(() => {
    const surface = input.surface.current
    if (!surface || !['full', 'canvas-edit'].includes(input.controller.profile.id)) return
    const adapter = imageEditExplanation(input.bus)
    const eventRoot = surface.ownerDocument
    let lastMove = 0
    const pointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !surface.contains(event.target)) return
      const correcting = adapter.hasPendingPick()
      if (adapter.snapshot().session?.state !== 'recording' && !correcting) return
      const value = latest.current, layout = value.layout
      if (!layout || !value.ready || Object.keys(value.bus.getSnapshot().previewOverrides).length) return
      if (event.target instanceof Element && event.target.closest('button,input,textarea,select,[contenteditable],[data-observation-sensitive]')) return
      // Sampling budget, not a duration or target limit; down/up are never throttled.
      if (event.type === 'pointermove') { if (event.timeStamp - lastMove < 50) return; lastMove = event.timeStamp }
      const rect = surface.getBoundingClientRect(), viewport = layout.viewport, document = value.controller.document
      const point: [number, number] = [(event.clientX - rect.left) / viewport.zoom + viewport.documentX, (event.clientY - rect.top) / viewport.zoom + viewport.documentY]
      const size = [Number(surface.dataset.previewOutputWidth), Number(surface.dataset.previewOutputHeight)] as [number, number]
      if (size.some(n => !Number.isFinite(n) || n <= 0)) return
      const inside = point[0] >= 0 && point[1] >= 0 && point[0] < size[0] && point[1] < size[1]
      const output = resolveAnnotationOutputGeometryV3(document)
      const sourcePoint = mapAffine(inverseAffine(output.sourceToOutput), point)
      const picked = inside ? pickImageEditorLayerV3(document, point, value.maps) : null
      const refs = picked ? [{ ...imageEditV3LayerRef(document.id, picked), label: findImageEditLayerLocationV3(document.layers, picked)?.layer.name }] : []
      if (correcting) {
        if (event.type === 'pointerdown' && inside) {
          event.preventDefault(); event.stopPropagation()
          adapter.acceptPick([point[0] / size[0], point[1] / size[1]], refs, value.selected.map(id => ({ ...imageEditV3LayerRef(document.id, id), label: findImageEditLayerLocationV3(document.layers, id)?.layer.name })))
        }
        return
      }
      const left = Math.max(rect.left, rect.left - viewport.documentX * viewport.zoom, 0)
      const top = Math.max(rect.top, rect.top - viewport.documentY * viewport.zoom, 0)
      const right = Math.min(rect.right, rect.left + (size[0] - viewport.documentX) * viewport.zoom, window.innerWidth)
      const bottom = Math.min(rect.bottom, rect.top + (size[1] - viewport.documentY) * viewport.zoom, window.innerHeight)
      const captureRect = { x: Math.ceil(left), y: Math.ceil(top), width: Math.floor(right - Math.ceil(left)), height: Math.floor(bottom - Math.ceil(top)) }
      const unobscured = (): boolean => ![...surface.ownerDocument.querySelectorAll<HTMLElement>('[data-panel-placement], [role="dialog"]')].some(overlay => {
        // The image editor itself can be a dialog host; only other overlays obscure it.
        if (overlay.contains(surface)) return false
        const box = overlay.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && box.left < right && box.right > left && box.top < bottom && box.bottom > top
      })
      const capture = inside && captureRect.width > 0 && captureRect.height > 0 && captureRect.width <= 4096 && captureRect.height <= 4096 ? async () => {
        // capturePage takes window DIP, while DOM rectangles include the application's
        // zoom. Use the actual content size; devicePixelRatio also includes monitor DPI.
        const viewSize = { width: window.innerWidth, height: window.innerHeight }
        const content = await getPlatform().window.getContentSize()
        if (!unobscured()) return null
        const sx = content.width / viewSize.width, sy = content.height / viewSize.height
        const x = Math.ceil(captureRect.x * sx), y = Math.ceil(captureRect.y * sy)
        const nativeRect = { x, y, width: Math.floor((captureRect.x + captureRect.width) * sx) - x, height: Math.floor((captureRect.y + captureRect.height) * sy) - y }
        if (window.innerWidth !== viewSize.width || window.innerHeight !== viewSize.height) return null
        const source = await getPlatform().media.captureApplicationSurface({ schemaVersion: SURFACE_OBSERVATION_SCHEMA_VERSION, target: value.controller.profile.id === 'canvas-edit' ? 'workspace.canvas' : 'tool.image_edit', rect: nativeRect, masks: [], maskPolicyId: 'surface.mask_declared_fields' })
        // A command, navigation, or preview overlay during capture invalidates association.
        if (!unobscured() || window.innerWidth !== viewSize.width || window.innerHeight !== viewSize.height || latest.current.controller.document !== document || latest.current.layout?.viewportKey !== layout.viewportKey || Object.keys(value.bus.getSnapshot().previewOverrides).length || !surface.isConnected) return null
        const image = await getPlatform().imageEditorV3.ingestSource({ requestId: crypto.randomUUID(), source: { kind: 'data-url', dataUrl: source.dataUrl } })
        return { resource: { resourceId: image.resource.resourceRef, digest: image.resource.resourceRef, bytes: image.resource.byteLength, path: `resources/${image.resource.resourceRef.slice(7)}`, kind: 'visual' as const }, size: [source.width, source.height] as [number, number], point: [(event.clientX * sx - x) / nativeRect.width, (event.clientY * sy - y) / nativeRect.height] as [number, number] }
      } : undefined
      adapter.recordPointer({ point: inside ? [point[0] / size[0], point[1] / size[1]] : null, documentPoint: inside ? [...sourcePoint] : null, viewPoint: [event.clientX, event.clientY], refs,
        selectedRefs: value.selected.map(id => ({ ...imageEditV3LayerRef(document.id, id), label: findImageEditLayerLocationV3(document.layers, id)?.layer.name })), phase: event.type === 'pointerdown' ? 'down' : event.type === 'pointerup' ? 'up' : event.type === 'pointercancel' ? 'cancel' : 'move', capture,
        geometry: { compositionSize: size, validViewRect: [rect.left, rect.top, rect.width, rect.height], documentToView: [...composeAffine([viewport.zoom, 0, 0, viewport.zoom, rect.left - viewport.documentX * viewport.zoom, rect.top - viewport.documentY * viewport.zoom], output.sourceToOutput)], crop: [document.geometry.crop?.x ?? 0, document.geometry.crop?.y ?? 0, ...size], orientationTurns: document.geometry.orientation.rotate / 360, pixelRatio: window.devicePixelRatio } })
    }
    const blur = (): void => { void adapter.pause(true).catch(() => {}) }
    // React tools stop propagation at their delegated root during capture. Observe before
    // that root, while the explicit surface containment keeps other windows/panels private.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) eventRoot.addEventListener(type, pointer as EventListener, true)
    window.addEventListener('blur', blur)
    return () => { for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) eventRoot.removeEventListener(type, pointer as EventListener, true); window.removeEventListener('blur', blur); void adapter.detach().catch(() => {}) }
  }, [input.bus, input.controller.profile.id, input.surface])
}
