import type { MarkItem } from '@/core/imageEdit/types'
import { createImageEditAnnotationLayerV3, createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import {
  ANNOTATION_DEFAULT_STROKE_HEX,
} from '@/core/theme/colorTokens'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useImageEditorInteractionStoreV3,
  useImageEditorSessionStoreV3,
} from '../store'
import { AnnotationSvgShapeV3 } from './AnnotationSvgShapeV3'
import {
  annotationMatrixToSvgV3,
  invertAnnotationMatrixV3,
  mapAnnotationPointV3,
  resolveAnnotationOutputGeometryV3,
  type AnnotationMatrixV3,
} from './annotationGeometryV3'
import {
  collectEditableAnnotationLayersV3,
  findSelectedAnnotationV3,
  getAnnotationBoundsV3,
  moveAnnotationV3,
  resizeAnnotationBoundsV3,
  resizeAnnotationFromBoundsV3,
  simplifyAnnotationPenPointsV3,
  type AnnotationBoundsV3,
  type AnnotationResizeHandleV3,
  type EditableAnnotationLayerV3,
} from './annotationModelV3'
import {
  captureEditorPointerV3,
  matchesEditorPointerV3,
  releaseEditorPointerV3,
  type CapturedEditorPointerV3,
} from './pointerCaptureV3'
import type { ImageEditorToolIdV3 } from '../application/imageEditorHostProfiles'
import {
  createAnnotationDraftV3,
  isAnnotationToolV3,
  isDrawableAnnotationV3,
  updateAnnotationDrawV3,
} from './annotationDrawingV3'
import type { ImageEditorV3Controller } from './types'

interface AnnotationGestureContextV3 {
  pointer: CapturedEditorPointerV3
  documentId: string
  documentRevision: number
  selectedLayerIdsKey: string
  selectionKey: string
  tool: ImageEditorToolIdV3
}

interface DrawGestureV3 extends AnnotationGestureContextV3 {
  kind: 'draw'
  layerId: string | null
  matrix: AnnotationMatrixV3
  inverse: AnnotationMatrixV3
  start: readonly [number, number]
  annotation: MarkItem
  lastClientPoint?: readonly [number, number]
}

interface MoveGestureV3 extends AnnotationGestureContextV3 {
  kind: 'move'
  layerId: string
  matrix: AnnotationMatrixV3
  inverse: AnnotationMatrixV3
  start: readonly [number, number]
  original: MarkItem
  annotation: MarkItem
}

interface ResizeGestureV3 extends AnnotationGestureContextV3 {
  kind: 'resize'
  layerId: string
  matrix: AnnotationMatrixV3
  inverse: AnnotationMatrixV3
  start: readonly [number, number]
  startBounds: AnnotationBoundsV3
  handle: AnnotationResizeHandleV3
  original: MarkItem
  annotation: MarkItem
}

type AnnotationGestureV3 = DrawGestureV3 | MoveGestureV3 | ResizeGestureV3

const EMPTY_IDS: readonly string[] = []

export function ImageEditorAnnotationOverlayV3({
  controller,
}: {
  controller: ImageEditorV3Controller
}): JSX.Element | null {
  const { t } = useTranslation('ui')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [gesture, setGesture] = useState<AnnotationGestureV3 | null>(null)
  const [handleRadius, setHandleRadius] = useState(5)
  const gestureRef = useRef<AnnotationGestureV3 | null>(null)
  const activeTool = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.activeTool ?? 'move',
  )
  const selectedLayerIds = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.selectedLayerIds ?? EMPTY_IDS,
  )
  const toolSettings = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.toolSettings,
  )
  const setSelectedLayerIds = useImageEditorSessionStoreV3((state) => state.setSelectedLayerIds)
  const selection = useImageEditorInteractionStoreV3(
    (state) => state.annotationSelectionBySession[controller.sessionId] ?? null,
  )
  const selectAnnotation = useImageEditorInteractionStoreV3((state) => state.selectAnnotation)
  const geometry = useMemo(
    () => resolveAnnotationOutputGeometryV3(controller.document),
    [controller.document],
  )
  const layers = useMemo(
    () => collectEditableAnnotationLayersV3(controller.document),
    [controller.document],
  )
  const selected = findSelectedAnnotationV3(layers, selection)
  const interactive = activeTool === 'move' || isAnnotationToolV3(activeTool)
  const selectedLayerIdsKey = selectedLayerIds.join('\u0000')
  const selectionKey = selection ? `${selection.layerId}\u0000${selection.annotationId}` : ''

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const update = (): void => {
      const rect = svg.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      setHandleRadius(Math.max(
        geometry.width / rect.width,
        geometry.height / rect.height,
      ) * 5)
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(svg)
    return () => observer?.disconnect()
  }, [geometry.height, geometry.width, interactive])

  useEffect(() => {
    if (!selection) return
    const selectionLayer = layers.find(({ layer }) => layer.id === selection.layerId)
    if (!selectedLayerIds.includes(selection.layerId)
      || (selectionLayer && !selected)) {
      selectAnnotation(controller.sessionId, null)
    }
  }, [controller.sessionId, layers, selectAnnotation, selected, selectedLayerIds, selection])

  const clientToOutput = useCallback((clientX: number, clientY: number): readonly [number, number] => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return [0, 0]
    return [
      (clientX - rect.left) / rect.width * geometry.width,
      (clientY - rect.top) / rect.height * geometry.height,
    ]
  }, [geometry.height, geometry.width])

  const pointForGesture = useCallback((
    current: AnnotationGestureV3,
    clientX: number,
    clientY: number,
  ): readonly [number, number] => mapAnnotationPointV3(
    current.inverse,
    clientToOutput(clientX, clientY),
  ), [clientToOutput])

  const updateGesture = useCallback((
    current: AnnotationGestureV3,
    clientX: number,
    clientY: number,
    shiftKey = false,
  ): AnnotationGestureV3 => {
    if (current.kind === 'draw' && current.annotation.type === 'pen') {
      if (current.lastClientPoint && Math.hypot(
        clientX - current.lastClientPoint[0],
        clientY - current.lastClientPoint[1],
      ) < 1.5) return current
      const point = pointForGesture(current, clientX, clientY)
      const next = { ...current, annotation: updateAnnotationDrawV3(
        current.annotation,
        current.start,
        point,
        shiftKey,
      ) }
      return { ...next, lastClientPoint: [clientX, clientY] }
    }
    const point = pointForGesture(current, clientX, clientY)
    if (current.kind === 'draw') return {
      ...current,
      annotation: updateAnnotationDrawV3(current.annotation, current.start, point, shiftKey),
    }
    const deltaX = point[0] - current.start[0]
    const deltaY = point[1] - current.start[1]
    if (current.kind === 'move') {
      return {
        ...current,
        annotation: moveAnnotationV3(current.original, deltaX, deltaY),
      }
    }
    const targetBounds = resizeAnnotationBoundsV3(
      current.startBounds,
      current.handle,
      deltaX,
      deltaY,
    )
    return {
      ...current,
      annotation: resizeAnnotationFromBoundsV3(
        current.original,
        current.startBounds,
        targetBounds,
      ),
    }
  }, [pointForGesture])

  const cancelGesture = useCallback((): void => {
    const current = gestureRef.current
    if (!current) return
    gestureRef.current = null
    releaseEditorPointerV3(current.pointer)
    setGesture(null)
  }, [])

  useEffect(() => () => {
    const current = gestureRef.current
    gestureRef.current = null
    if (current) releaseEditorPointerV3(current.pointer)
  }, [])

  useEffect(() => {
    const current = gestureRef.current
    if (!current) return
    if (
      controller.document.id !== current.documentId
      || controller.document.revision !== current.documentRevision
      || activeTool !== current.tool
      || selectedLayerIdsKey !== current.selectedLayerIdsKey
      || selectionKey !== current.selectionKey
    ) {
      cancelGesture()
    }
  }, [
    activeTool,
    cancelGesture,
    controller.document.id,
    controller.document.revision,
    selectedLayerIdsKey,
    selectionKey,
  ])

  const moveGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gestureRef.current
    if (!current || !matchesEditorPointerV3(current.pointer, event.pointerId)) return
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [event]
    let next = current
    for (const sample of samples) {
      next = updateGesture(next, sample.clientX, sample.clientY, sample.shiftKey)
    }
    gestureRef.current = next
    setGesture(next)
  }

  const finishGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gestureRef.current
    if (!current || !matchesEditorPointerV3(current.pointer, event.pointerId)) return
    const endPoint = pointForGesture(current, event.clientX, event.clientY)
    let final = updateGesture(current, event.clientX, event.clientY, event.shiftKey)
    if (final.kind === 'draw' && final.annotation.type === 'pen') {
      const unit = pointForGesture(final, event.clientX + 1, event.clientY)
      const tolerance = Math.max(0.01, Math.hypot(
        unit[0] - endPoint[0],
        unit[1] - endPoint[1],
      ) * 0.75)
      final = {
        ...final,
        annotation: {
          ...final.annotation,
          points: simplifyAnnotationPenPointsV3(final.annotation.points, tolerance),
        },
      }
    }
    gestureRef.current = null
    releaseEditorPointerV3(current.pointer)
    setGesture(null)
    if (final.kind === 'move' || final.kind === 'resize') {
      if (Math.hypot(endPoint[0] - final.start[0], endPoint[1] - final.start[1]) >= 0.01) {
        controller.updateAnnotation(final.layerId, final.annotation.id, final.annotation)
      }
      return
    }
    if (!isDrawableAnnotationV3(final.annotation)) return
    let layerId = final.layerId
    if (layerId) {
      controller.addAnnotation(layerId, final.annotation)
    } else {
      const layer = createImageEditAnnotationLayerV3(
        createImageEditIdV3('layer'),
        t('imageEditor.v3.layerType.annotation'),
      )
      layer.annotations = [final.annotation]
      layerId = layer.id
      controller.addLayer(layer, null, controller.document.layers.length)
      setSelectedLayerIds(controller.sessionId, [layer.id])
    }
    selectAnnotation(controller.sessionId, {
      layerId,
      annotationId: final.annotation.id,
    })
  }

  const cancelPointerGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gestureRef.current
    if (!current || !matchesEditorPointerV3(current.pointer, event.pointerId)) return
    cancelGesture()
  }

  const targetLayer = (): EditableAnnotationLayerV3 | null => {
    if (selectedLayerIds.length !== 1) return null
    return layers.find(({ layer, locked }) => layer.id === selectedLayerIds[0] && !locked) ?? null
  }

  const startDraw = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!isAnnotationToolV3(activeTool) || event.button !== 0 || gestureRef.current) return
    const target = targetLayer()
    const matrix = target?.matrix ?? geometry.sourceToOutput
    const inverse = invertAnnotationMatrixV3(matrix)
    const start = mapAnnotationPointV3(inverse, clientToOutput(event.clientX, event.clientY))
    const next: DrawGestureV3 = {
      kind: 'draw',
      pointer: captureEditorPointerV3(event.currentTarget, event.pointerId),
      documentId: controller.document.id,
      documentRevision: controller.document.revision,
      selectedLayerIdsKey,
      selectionKey,
      tool: activeTool,
      layerId: target?.layer.id ?? null,
      matrix,
      inverse,
      start,
      annotation: createAnnotationDraftV3(
        activeTool,
        start,
        toolSettings?.annotationStrokeWidth ?? 4,
        toolSettings?.annotationFontSize ?? 32,
        t('imageEditor.v3.annotation.defaultText'),
        t('imageEditor.v3.annotation.defaultCallout'),
        toolSettings?.annotationColor ?? ANNOTATION_DEFAULT_STROKE_HEX,
        toolSettings?.annotationCalloutShape ?? 'rect',
      ),
      lastClientPoint: [event.clientX, event.clientY],
    }
    gestureRef.current = next
    setGesture(next)
    event.preventDefault()
  }

  const startMove = (
    event: ReactPointerEvent<SVGGElement>,
    entry: EditableAnnotationLayerV3,
    annotation: MarkItem,
  ): void => {
    event.stopPropagation()
    if (gestureRef.current) return
    setSelectedLayerIds(controller.sessionId, [entry.layer.id])
    selectAnnotation(controller.sessionId, { layerId: entry.layer.id, annotationId: annotation.id })
    if (activeTool !== 'move' || entry.locked || event.button !== 0) return
    const captureTarget = svgRef.current
    if (!captureTarget) return
    const inverse = invertAnnotationMatrixV3(entry.matrix)
    const next: MoveGestureV3 = {
      kind: 'move',
      pointer: captureEditorPointerV3(captureTarget, event.pointerId),
      documentId: controller.document.id,
      documentRevision: controller.document.revision,
      selectedLayerIdsKey: entry.layer.id,
      selectionKey: `${entry.layer.id}\u0000${annotation.id}`,
      tool: activeTool,
      layerId: entry.layer.id,
      matrix: entry.matrix,
      inverse,
      start: mapAnnotationPointV3(inverse, clientToOutput(event.clientX, event.clientY)),
      original: annotation,
      annotation,
    }
    gestureRef.current = next
    setGesture(next)
    event.preventDefault()
  }

  const startResize = (
    event: ReactPointerEvent<SVGCircleElement>,
    entry: EditableAnnotationLayerV3,
    annotation: MarkItem,
    handle: AnnotationResizeHandleV3,
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    if (activeTool !== 'move' || entry.locked || event.button !== 0 || gestureRef.current) return
    const captureTarget = svgRef.current
    if (!captureTarget) return
    const inverse = invertAnnotationMatrixV3(entry.matrix)
    const next: ResizeGestureV3 = {
      kind: 'resize',
      pointer: captureEditorPointerV3(captureTarget, event.pointerId),
      documentId: controller.document.id,
      documentRevision: controller.document.revision,
      selectedLayerIdsKey: entry.layer.id,
      selectionKey: `${entry.layer.id}\u0000${annotation.id}`,
      tool: activeTool,
      layerId: entry.layer.id,
      matrix: entry.matrix,
      inverse,
      start: mapAnnotationPointV3(inverse, clientToOutput(event.clientX, event.clientY)),
      startBounds: getAnnotationBoundsV3(annotation),
      handle,
      original: annotation,
      annotation,
    }
    gestureRef.current = next
    setGesture(next)
  }

  const deleteSelected = (): void => {
    if (!selection || !selected || selected.entry.locked) return
    controller.deleteAnnotation(selection.layerId, selection.annotationId)
    selectAnnotation(controller.sessionId, null)
  }

  if (activeTool === 'crop' || (!interactive && !selection)) return null
  return (
    /* icon-token-allow: 这是按文档像素坐标编辑标注的 SVG 画布，不是界面图标。 */
    <svg
      ref={svgRef}
      data-annotation-editor-overlay
      aria-label={t('imageEditor.v3.annotation.overlay')}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="none"
      className={`absolute inset-0 h-full w-full touch-none ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
      tabIndex={interactive ? 0 : -1}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          if (activeTool === 'move') selectAnnotation(controller.sessionId, null)
          else startDraw(event)
        }
      }}
      onPointerMove={moveGesture}
      onPointerUp={finishGesture}
      onPointerCancel={cancelPointerGesture}
      onLostPointerCapture={cancelPointerGesture}
      onKeyDown={(event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault()
          deleteSelected()
        }
      }}
    >
      {layers.map((entry) => (
        <g key={entry.layer.id} transform={annotationMatrixToSvgV3(entry.matrix)}>
          {entry.layer.annotations.map((annotation) => {
            const moving = (gesture?.kind === 'move' || gesture?.kind === 'resize')
              && gesture.layerId === entry.layer.id
              && gesture.annotation.id === annotation.id
            return (
              <AnnotationSvgShapeV3
                key={annotation.id}
                annotation={moving ? gesture.annotation : annotation}
                selected={selection?.layerId === entry.layer.id && selection.annotationId === annotation.id}
                draft={moving}
                handleRadius={handleRadius}
                onPointerDown={(event) => startMove(event, entry, annotation)}
                onResizePointerDown={activeTool === 'move' && !entry.locked
                  && selection?.layerId === entry.layer.id
                  && selection.annotationId === annotation.id
                  ? (event, handle) => startResize(event, entry, annotation, handle)
                  : undefined}
              />
            )
          })}
        </g>
      ))}
      {gesture?.kind === 'draw' ? (
        <g transform={annotationMatrixToSvgV3(gesture.matrix)} pointerEvents="none">
          <AnnotationSvgShapeV3 annotation={gesture.annotation} draft />
        </g>
      ) : null}
    </svg>
  )
}
