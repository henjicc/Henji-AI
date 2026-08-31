import type { MarkItem } from '@/core/imageEdit/types'
import { createImageEditAnnotationLayerV3, createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import {
  ANNOTATION_DEFAULT_STROKE_HEX,
  ANNOTATION_DEFAULT_TEXT_HEX,
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
  moveAnnotationV3,
  simplifyAnnotationPenPointsV3,
  type EditableAnnotationLayerV3,
} from './annotationModelV3'
import {
  captureEditorPointerV3,
  matchesEditorPointerV3,
  releaseEditorPointerV3,
  type CapturedEditorPointerV3,
} from './pointerCaptureV3'
import type { ImageEditorToolIdV3 } from '../application/imageEditorHostProfiles'
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

type AnnotationGestureV3 = DrawGestureV3 | MoveGestureV3
type AnnotationToolV3 = Extract<
  ImageEditorToolIdV3,
  'annotation-text' | 'annotation-arrow' | 'annotation-rect' | 'annotation-pen'
>

const EMPTY_IDS: readonly string[] = []

function isAnnotationTool(tool: ImageEditorToolIdV3): tool is AnnotationToolV3 {
  return tool === 'annotation-text'
    || tool === 'annotation-arrow'
    || tool === 'annotation-rect'
    || tool === 'annotation-pen'
}

function createDraftAnnotation(
  tool: AnnotationToolV3,
  point: readonly [number, number],
  strokeWidth: number,
  fontSize: number,
  text: string,
): MarkItem {
  const id = createImageEditIdV3('annotation')
  if (tool === 'annotation-text') {
    return { id, type: 'text', x: point[0], y: point[1], text, color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize }
  }
  if (tool === 'annotation-arrow') {
    return { id, type: 'arrow', points: [point[0], point[1], point[0], point[1]], stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: strokeWidth }
  }
  if (tool === 'annotation-rect') {
    return { id, type: 'rect', x: point[0], y: point[1], width: 0, height: 0, stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: strokeWidth }
  }
  return { id, type: 'pen', points: [point[0], point[1], point[0], point[1]], stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: strokeWidth }
}

function updateDrawGesture(
  gesture: DrawGestureV3,
  point: readonly [number, number],
): DrawGestureV3 {
  const { annotation, start } = gesture
  if (annotation.type === 'arrow') {
    return { ...gesture, annotation: { ...annotation, points: [start[0], start[1], point[0], point[1]] } }
  }
  if (annotation.type === 'rect') {
    return {
      ...gesture,
      annotation: {
        ...annotation,
        x: Math.min(start[0], point[0]),
        y: Math.min(start[1], point[1]),
        width: Math.abs(point[0] - start[0]),
        height: Math.abs(point[1] - start[1]),
      },
    }
  }
  if (annotation.type === 'pen') {
    annotation.points.push(point[0], point[1])
    return { ...gesture, annotation: { ...annotation } }
  }
  return gesture
}

function isDrawableAnnotation(annotation: MarkItem): boolean {
  if (annotation.type === 'rect') return annotation.width >= 1 && annotation.height >= 1
  if (annotation.type === 'arrow') {
    return Math.hypot(
      annotation.points[2] - annotation.points[0],
      annotation.points[3] - annotation.points[1],
    ) >= 1
  }
  if (annotation.type !== 'pen' || annotation.points.length < 4) return annotation.type !== 'pen'
  const startX = annotation.points[0]
  const startY = annotation.points[1]
  return annotation.points.some((value, index) => (
    index >= 2 && index % 2 === 0
      ? Math.hypot(value - startX, annotation.points[index + 1] - startY) >= 1
      : false
  ))
}

export function ImageEditorAnnotationOverlayV3({
  controller,
}: {
  controller: ImageEditorV3Controller
}): JSX.Element | null {
  const { t } = useTranslation('ui')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [gesture, setGesture] = useState<AnnotationGestureV3 | null>(null)
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
  const interactive = activeTool === 'move' || isAnnotationTool(activeTool)
  const selectedLayerIdsKey = selectedLayerIds.join('\u0000')
  const selectionKey = selection ? `${selection.layerId}\u0000${selection.annotationId}` : ''

  useEffect(() => {
    if (!selection) return
    if (!selected || !selectedLayerIds.includes(selection.layerId)) {
      selectAnnotation(controller.sessionId, null)
    }
  }, [controller.sessionId, selectAnnotation, selected, selectedLayerIds, selection])

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
  ): AnnotationGestureV3 => {
    if (current.kind === 'draw' && current.annotation.type === 'pen') {
      if (current.lastClientPoint && Math.hypot(
        clientX - current.lastClientPoint[0],
        clientY - current.lastClientPoint[1],
      ) < 1.5) return current
      const point = pointForGesture(current, clientX, clientY)
      const next = updateDrawGesture(current, point)
      return { ...next, lastClientPoint: [clientX, clientY] }
    }
    const point = pointForGesture(current, clientX, clientY)
    if (current.kind === 'draw') return updateDrawGesture(current, point)
    return {
      ...current,
      annotation: moveAnnotationV3(
        current.original,
        point[0] - current.start[0],
        point[1] - current.start[1],
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
      next = updateGesture(next, sample.clientX, sample.clientY)
    }
    gestureRef.current = next
    setGesture(next)
  }

  const finishGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gestureRef.current
    if (!current || !matchesEditorPointerV3(current.pointer, event.pointerId)) return
    const endPoint = pointForGesture(current, event.clientX, event.clientY)
    let final = updateGesture(current, event.clientX, event.clientY)
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
    if (final.kind === 'move') {
      if (Math.hypot(endPoint[0] - final.start[0], endPoint[1] - final.start[1]) >= 0.01) {
        controller.updateAnnotation(final.layerId, final.annotation.id, final.annotation)
      }
      return
    }
    if (!isDrawableAnnotation(final.annotation)) return
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
    if (!isAnnotationTool(activeTool) || event.button !== 0 || gestureRef.current) return
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
      annotation: createDraftAnnotation(
        activeTool,
        start,
        toolSettings?.annotationStrokeWidth ?? 4,
        toolSettings?.annotationFontSize ?? 32,
        t('imageEditor.v3.annotation.defaultText'),
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

  const deleteSelected = (): void => {
    if (!selection || !selected || selected.entry.locked) return
    controller.deleteAnnotation(selection.layerId, selection.annotationId)
    selectAnnotation(controller.sessionId, null)
  }

  if (!interactive && !selection) return null
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
            const moving = gesture?.kind === 'move'
              && gesture.layerId === entry.layer.id
              && gesture.annotation.id === annotation.id
            return (
              <AnnotationSvgShapeV3
                key={annotation.id}
                annotation={moving ? gesture.annotation : annotation}
                selected={selection?.layerId === entry.layer.id && selection.annotationId === annotation.id}
                draft={moving}
                onPointerDown={(event) => startMove(event, entry, annotation)}
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
