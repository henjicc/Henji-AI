import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Layer, Rect, Stage } from 'react-konva'
import Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useTranslation } from 'react-i18next'

import type { MarkItem } from '@/core/imageEdit/types'
import { DEFAULT_MOSAIC_STRENGTH_PERCENT } from '@/core/imageEdit/constraints'
import { createImageEditAnnotationLayerV3, createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens'
import { isLabeledMark } from '@/features/imageMark/domain/types'
import { updateMarkPosition } from '@/features/imageMark/domain/geometry'
import { resolveNumberValues } from '@/features/imageMark/render/drawMarks'
import { TextEditOverlay } from '@/features/imageMark/editor/TextEditOverlay'

import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'
import {
  invertAnnotationMatrixV3,
  mapAnnotationPointV3,
  resolveAnnotationOutputGeometryV3,
  type AnnotationMatrixV3,
} from './annotationGeometryV3'
import { collectEditableAnnotationLayersV3, type EditableAnnotationLayerV3 } from './annotationModelV3'
import {
  createAnnotationDraftV3,
  isAnnotationToolV3,
  isDrawableAnnotationV3,
  type AnnotationToolV3,
  updateAnnotationDrawV3,
} from './annotationDrawingV3'
import { splitLiveAnnotationDisplayV3 } from './liveAnnotationDisplayV3'
import { ImageEditorLiveAnnotationLayersV3 } from './ImageEditorLiveAnnotationLayersV3'
import { useImageEditorAnnotationTextV3 } from './useImageEditorAnnotationTextV3'
import type { ImageEditorV3Controller } from './types'

interface DrawGestureV3 {
  entry: EditableAnnotationLayerV3 | null
  matrix: AnnotationMatrixV3
  start: readonly [number, number]
  annotation: MarkItem
  documentId: string
  documentRevision: number
  tool: AnnotationToolV3
}

const EMPTY_IDS: readonly string[] = []
export function ImageEditorAnnotationOverlayV3({
  controller,
  enabled = true,
}: {
  controller: ImageEditorV3Controller
  enabled?: boolean
}): JSX.Element | null {
  const { t } = useTranslation('ui')
  const hostRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const shapeRefs = useRef<Map<string, Konva.Node>>(new Map())
  const labelRefs = useRef<Map<string, Konva.Node>>(new Map())
  const transformerRef = useRef<Konva.Transformer | null>(null)
  const drawRef = useRef<DrawGestureV3 | null>(null)
  const pointerGestureHandledRef = useRef(false)
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 })
  const [draft, setDraft] = useState<DrawGestureV3 | null>(null)
  const [activeLabelId, setActiveLabelId] = useState<string | null>(null)

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
  const annotationPreview = useImageEditorInteractionStoreV3(
    (state) => state.annotationPreviewBySession[controller.sessionId] ?? null,
  )

  const geometry = useMemo(
    () => resolveAnnotationOutputGeometryV3(controller.document),
    [controller.document],
  )
  const liveLayerIds = useMemo(() => new Set(
    splitLiveAnnotationDisplayV3(controller.document).liveLayers.map(({ id }) => id),
  ), [controller.document])
  const committedEntries = useMemo(
    () => collectEditableAnnotationLayersV3(controller.document)
      .filter(({ layer }) => liveLayerIds.has(layer.id)),
    [controller.document, liveLayerIds],
  )
  const entries = useMemo(() => committedEntries.map((entry) => {
    if (!annotationPreview || annotationPreview.layerId !== entry.layer.id) return entry
    const annotations = entry.layer.annotations.map((item) => (
      item.id === annotationPreview.annotationId ? annotationPreview.annotation : item
    ))
    return { ...entry, layer: { ...entry.layer, annotations } }
  }), [annotationPreview, committedEntries])
  const selectedEntry = selection
    ? entries.find(({ layer }) => layer.id === selection.layerId) ?? null
    : null
  const selectedItem = selectedEntry?.layer.annotations
    .find(({ id }) => id === selection?.annotationId) ?? null
  const selectedIsLabel = Boolean(selectedItem && activeLabelId === selectedItem.id)
  const selectedLiveLayer = selectedLayerIds.length === 1 && liveLayerIds.has(selectedLayerIds[0])
  const interactive = isAnnotationToolV3(activeTool) || (activeTool === 'move' && selectedLiveLayer)
  const shouldRender = enabled && activeTool !== 'crop' && (interactive || entries.length > 0)
  const widthScale = displaySize.width / Math.max(1, geometry.width)
  const heightScale = displaySize.height / Math.max(1, geometry.height)
  const stageScale = Math.min(widthScale, heightScale)
  const sourceWidth = controller.document.geometry.width
  const sourceHeight = controller.document.geometry.height
  const numberValues = useMemo(
    () => resolveNumberValues(entries.flatMap(({ layer }) => layer.annotations)),
    [entries],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const publish = (): void => {
      const rect = host.getBoundingClientRect()
      // getBoundingClientRect 已经包含父级视口 zoom；Stage 跟随父级一起缩放，内部尺寸必须取
      // 未变换的布局像素，否则会被重复放大并造成绘制命中偏移。
      const width = host.clientWidth || rect.width
      const height = host.clientHeight || rect.height
      setDisplaySize((current) => current.width === width && current.height === height
        ? current
        : { width, height })
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(host)
    return () => observer.disconnect()
  }, [shouldRender])

  useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer) return
    const node = selectedItem
      ? (selectedIsLabel ? labelRefs.current : shapeRefs.current).get(selectedItem.id)
      : null
    transformer.nodes(node ? [node] : [])
    transformer.getLayer()?.batchDraw()
  }, [controller.document.revision, selectedIsLabel, selectedItem])

  useEffect(() => {
    if (selection && (!selectedEntry || !selectedItem)) {
      selectAnnotation(controller.sessionId, null)
      setActiveLabelId(null)
    }
  }, [controller.sessionId, selectAnnotation, selectedEntry, selectedItem, selection])

  useLayoutEffect(() => {
    const gesture = drawRef.current
    if (!gesture) return
    if (
      gesture.tool === activeTool
      && gesture.documentId === controller.document.id
      && gesture.documentRevision === controller.document.revision
    ) return
    drawRef.current = null
    setDraft(null)
  }, [activeTool, controller.document.id, controller.document.revision])

  const stagePointToLayerPoint = useCallback((
    matrix: AnnotationMatrixV3,
    point: { x: number; y: number },
  ): readonly [number, number] | null => {
    if (widthScale <= 0 || heightScale <= 0) return null
    return mapAnnotationPointV3(
      invertAnnotationMatrixV3(matrix),
      [point.x / widthScale, point.y / heightScale],
    )
  }, [heightScale, widthScale])

  const clientToStagePoint = useCallback((clientX: number, clientY: number) => {
    const host = hostRef.current
    if (!host || displaySize.width <= 0 || displaySize.height <= 0) return null
    const rect = host.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: (clientX - rect.left) * displaySize.width / rect.width,
      y: (clientY - rect.top) * displaySize.height / rect.height,
    }
  }, [displaySize])

  const select = useCallback((entry: EditableAnnotationLayerV3, id: string, label = false) => {
    setSelectedLayerIds(controller.sessionId, [entry.layer.id])
    selectAnnotation(controller.sessionId, { layerId: entry.layer.id, annotationId: id })
    setActiveLabelId(label ? id : null)
  }, [controller.sessionId, selectAnnotation, setSelectedLayerIds])

  const commitItem = useCallback((entry: EditableAnnotationLayerV3, item: MarkItem) => {
    controller.updateAnnotation(entry.layer.id, item.id, item)
    select(entry, item.id)
  }, [controller, select])

  const addItem = useCallback((entry: EditableAnnotationLayerV3 | null, item: MarkItem): string => {
    if (entry) {
      controller.addAnnotation(entry.layer.id, item)
      setSelectedLayerIds(controller.sessionId, [entry.layer.id])
      selectAnnotation(controller.sessionId, { layerId: entry.layer.id, annotationId: item.id })
      return entry.layer.id
    }
    const layer = createImageEditAnnotationLayerV3(
      createImageEditIdV3('layer'),
      t('imageEditor.v3.layerType.annotation'),
    )
    layer.annotations = [item]
    controller.addLayer(layer, null, controller.document.layers.length)
    setSelectedLayerIds(controller.sessionId, [layer.id])
    selectAnnotation(controller.sessionId, { layerId: layer.id, annotationId: item.id })
    return layer.id
  }, [controller, selectAnnotation, setSelectedLayerIds, t])

  const targetEntry = useCallback((): EditableAnnotationLayerV3 | null => {
    if (selectedLayerIds.length !== 1) return null
    return entries.find(({ layer, locked }) => layer.id === selectedLayerIds[0] && !locked) ?? null
  }, [entries, selectedLayerIds])

  const clearSelection = useCallback(() => {
    selectAnnotation(controller.sessionId, null)
  }, [controller.sessionId, selectAnnotation])
  const {
    textEditor,
    textInputRef,
    textPosition,
    openTextEditor,
    commitTextEditor,
    updateTextValue,
    cancelTextEditor,
  } = useImageEditorAnnotationTextV3({
    controller,
    entries,
    sourceToOutput: geometry.sourceToOutput,
    sourceWidth,
    sourceHeight,
    widthScale,
    heightScale,
    toolSettings,
    addItem,
    commitItem,
    clearSelection,
  })

  const beginDrawAtStagePoint = (stagePoint: { x: number; y: number }, button = 0): boolean => {
    if (drawRef.current || !isAnnotationToolV3(activeTool) || textEditor || button !== 0) return false
    const entry = targetEntry()
    const matrix = entry?.matrix ?? geometry.sourceToOutput
    const point = stagePointToLayerPoint(matrix, stagePoint)
    if (!point) return false
    if (activeTool === 'annotation-text') {
      openTextEditor(entry, null, point)
      return true
    }
    const annotation = createAnnotationDraftV3(
      activeTool,
      point,
      {
        strokeWidth: toolSettings?.annotationStrokeWidth ?? 4,
        fontSize: toolSettings?.annotationFontSize ?? 32,
        text: '',
        calloutText: '',
        color: toolSettings?.annotationColor ?? ANNOTATION_DEFAULT_STROKE_HEX,
        calloutShape: toolSettings?.annotationCalloutShape ?? 'rect',
        textBackgroundColor: toolSettings?.annotationTextBackgroundEnabled
          ? toolSettings.annotationTextBackgroundColor
          : undefined,
        mosaicMode: toolSettings?.annotationMosaicMode ?? 'pixel',
        mosaicStrength: toolSettings?.annotationMosaicStrength ?? DEFAULT_MOSAIC_STRENGTH_PERCENT,
      },
    )
    if (activeTool === 'annotation-number') {
      addItem(entry, annotation)
      return true
    }
    const next: DrawGestureV3 = {
      entry,
      matrix,
      start: point,
      annotation,
      documentId: controller.document.id,
      documentRevision: controller.document.revision,
      tool: activeTool,
    }
    drawRef.current = next
    setDraft(next)
    return true
  }

  const beginDraw = (event: KonvaEventObject<MouseEvent | TouchEvent>): void => {
    if (pointerGestureHandledRef.current) return
    const point = stageRef.current?.getPointerPosition()
    if (!point) return
    const mouseEvent = event.evt as MouseEvent
    beginDrawAtStagePoint(point, 'button' in mouseEvent ? mouseEvent.button : 0)
  }

  const moveDrawAtStagePoint = (stagePoint: { x: number; y: number }, shiftKey: boolean): void => {
    const current = drawRef.current
    if (!current) return
    const point = stagePointToLayerPoint(current.matrix, stagePoint)
    if (!point) return
    const next = {
      ...current,
      annotation: updateAnnotationDrawV3(current.annotation, current.start, point, shiftKey),
    }
    drawRef.current = next
    setDraft(next)
  }

  const moveDraw = (event: KonvaEventObject<MouseEvent | TouchEvent>): void => {
    if (pointerGestureHandledRef.current) return
    const point = stageRef.current?.getPointerPosition()
    if (!point) return
    moveDrawAtStagePoint(point, 'shiftKey' in event.evt ? event.evt.shiftKey : false)
  }

  const finishDraw = (): void => {
    const current = drawRef.current
    if (!current) return
    drawRef.current = null
    setDraft(null)
    if (
      current.tool !== activeTool
      || current.documentId !== controller.document.id
      || current.documentRevision !== controller.document.revision
    ) return
    if (!isDrawableAnnotationV3(current.annotation)) return
    const layerId = addItem(current.entry, current.annotation)
    if (current.tool === 'annotation-callout' && isLabeledMark(current.annotation)) {
      const temporaryEntry = current.entry ?? {
        layer: { ...createImageEditAnnotationLayerV3(layerId, ''), annotations: [current.annotation] },
        matrix: current.matrix,
        locked: false,
      }
      openTextEditor(temporaryEntry, current.annotation)
    }
  }

  useEffect(() => {
    if (!interactive) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if ((event.key === 'Delete' || event.key === 'Backspace') && selection && selectedEntry && !selectedEntry.locked) {
        event.preventDefault()
        controller.deleteAnnotation(selection.layerId, selection.annotationId)
        selectAnnotation(controller.sessionId, null)
      } else if (event.key.startsWith('Arrow') && selectedItem && selectedEntry && !selectedEntry.locked) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        const x = selectedItem.type === 'arrow' || selectedItem.type === 'pen'
          ? selectedItem.points[0]
          : selectedItem.x
        const y = selectedItem.type === 'arrow' || selectedItem.type === 'pen'
          ? selectedItem.points[1]
          : selectedItem.y
        commitItem(selectedEntry, updateMarkPosition(selectedItem, x + dx, y + dy))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commitItem, controller, interactive, selectAnnotation, selectedEntry, selectedItem, selection])

  if (!shouldRender) return null

  return (
    <div
      ref={hostRef}
      data-annotation-editor-overlay
      data-annotation-drawing={draft ? 'true' : 'false'}
      data-live-annotation-layer-count={entries.length}
      data-selected-annotation-type={selectedItem?.type}
      aria-label={t('imageEditor.v3.annotation.overlay')}
      className={`absolute inset-0 touch-none ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
      onPointerDownCapture={(event) => {
        if (!isAnnotationToolV3(activeTool) || textEditor) return
        const stage = stageRef.current
        const point = clientToStagePoint(event.clientX, event.clientY)
        if (!stage || !point) return
        const target = stage.getIntersection(point)
        if (target && target.name() !== 'mark-background') return
        if (!beginDrawAtStagePoint(point, event.button)) return
        pointerGestureHandledRef.current = true
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMoveCapture={(event) => {
        if (!pointerGestureHandledRef.current || !drawRef.current) return
        const point = clientToStagePoint(event.clientX, event.clientY)
        if (point) moveDrawAtStagePoint(point, event.shiftKey)
      }}
      onPointerUpCapture={() => {
        if (!pointerGestureHandledRef.current) return
        finishDraw()
        pointerGestureHandledRef.current = false
      }}
      onPointerCancelCapture={() => {
        if (!pointerGestureHandledRef.current) return
        drawRef.current = null
        setDraft(null)
        pointerGestureHandledRef.current = false
      }}
    >
      {displaySize.width > 0 && displaySize.height > 0 ? (
        <Stage
          ref={(node) => { stageRef.current = node }}
          width={displaySize.width}
          height={displaySize.height}
          onMouseDown={(event) => {
            if (event.target === event.target.getStage() || event.target.name() === 'mark-background') {
              if (activeTool === 'move') selectAnnotation(controller.sessionId, null)
              else beginDraw(event)
            }
          }}
          onTouchStart={(event) => {
            if (event.target === event.target.getStage() || event.target.name() === 'mark-background') beginDraw(event)
          }}
          onMouseMove={moveDraw}
          onTouchMove={moveDraw}
          onMouseUp={finishDraw}
          onTouchEnd={finishDraw}
          className={activeTool === 'move' ? 'cursor-default' : 'cursor-crosshair'}
        >
          <Layer>
            <Rect
              name="mark-background"
              x={0}
              y={0}
              width={displaySize.width}
              height={displaySize.height}
              fill="transparent"
            />
            <ImageEditorLiveAnnotationLayersV3
              activeTool={activeTool}
              entries={entries}
              selectedEntry={selectedEntry}
              selectedItem={selectedItem}
              activeLabelId={activeLabelId}
              textEditor={textEditor?.state ?? null}
              draft={draft}
              widthScale={widthScale}
              heightScale={heightScale}
              sourceWidth={sourceWidth}
              sourceHeight={sourceHeight}
              stageScale={stageScale}
              numberValues={numberValues}
              shapeRefs={shapeRefs}
              labelRefs={labelRefs}
              transformerRef={transformerRef}
              onSelect={select}
              onCommitItem={commitItem}
              onOpenTextEditor={(entry, item) => openTextEditor(entry, item)}
            />
          </Layer>
        </Stage>
      ) : null}
      {textEditor && textPosition ? (
        <TextEditOverlay
          state={textEditor.state}
          position={textPosition}
          scale={stageScale}
          textInputRef={textInputRef}
          onChange={updateTextValue}
          onCommit={commitTextEditor}
          onCancel={cancelTextEditor}
        />
      ) : null}
    </div>
  )
}
