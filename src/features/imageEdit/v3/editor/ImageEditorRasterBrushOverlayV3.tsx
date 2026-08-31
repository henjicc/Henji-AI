import type { ImageEditBrushPointV3, ImageEditBrushTileChangeV3 } from '@/core/imageEdit/v3/brush/contracts'
import { linearPreviewTileToImageDataV3 } from '@/features/imageEdit/v3/execution/previewPixelsV3'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { useImageEditorSessionStoreV3 } from '../store'
import {
  annotationMatrixToSvgV3,
  mapAnnotationPointV3,
  resolveAnnotationOutputGeometryV3,
  type AnnotationMatrixV3,
} from './annotationGeometryV3'
import { ImageEditorRasterBrushInputQueueV3 } from './rasterBrushInputQueueV3'
import {
  captureEditorPointerV3,
  matchesEditorPointerV3,
  releaseEditorPointerV3,
  type CapturedEditorPointerV3,
} from './pointerCaptureV3'
import { RasterBrushCommittedOverlayCacheV3 } from './rasterBrushCommittedOverlayV3'
import { ImageEditorRasterBrushStrokeV3 } from './rasterBrushStrokeV3'
import {
  resolveImageEditorBrushEditingTargetV3,
  type ImageEditorBrushToolIdV3,
} from './brushEditingTargetV3'
import { maskBrushTileToImageDataV3 } from './maskBrushPreviewPixelsV3'
import type { ImageEditorV3Controller } from './types'

const EMPTY_IDS: readonly string[] = []

interface RasterBrushOverlayStateV3 {
  matrix: AnnotationMatrixV3
  tiles: ReadonlyMap<string, ImageEditBrushTileChangeV3>
}

interface ActiveRasterBrushGestureV3 {
  stroke: ImageEditorRasterBrushStrokeV3
  queue: ImageEditorRasterBrushInputQueueV3
  inverseMatrix: AnnotationMatrixV3
  pointer: CapturedEditorPointerV3
  documentId: string
  documentRevision: number
  selectedLayerIdsKey: string
  tool: ImageEditorBrushToolIdV3
  phase: 'drawing' | 'finishing'
  committedRevision?: number
}

function RasterBrushTileCanvasV3({ change }: { change: ImageEditBrushTileChangeV3 }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = change.tile.width
    canvas.height = change.tile.height
    const imageData = change.tile.storage === 'rgba-float32'
      ? linearPreviewTileToImageDataV3(change.tile)
      : maskBrushTileToImageDataV3(change.tile)
    canvas.getContext('2d')?.putImageData(imageData, 0, 0)
  }, [change])
  return (
    <canvas
      ref={canvasRef}
      width={change.tile.width}
      height={change.tile.height}
      className="h-full w-full"
    />
  )
}

function pressureOf(event: PointerEvent | ReactPointerEvent<SVGSVGElement>): number {
  return event.pointerType === 'mouse' || event.pressure <= 0 ? 1 : event.pressure
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ImageEditorRasterBrushOverlayV3({
  bus,
  controller,
  resourceByteSizes,
  basePreviewDocumentId,
  basePreviewRevision,
}: {
  bus: ImageEditCommandBusV3
  controller: ImageEditorV3Controller
  resourceByteSizes?: Readonly<Record<string, number>>
  basePreviewDocumentId: string | null
  basePreviewRevision: number | null
}): JSX.Element | null {
  const { t } = useTranslation('ui')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const gestureRef = useRef<ActiveRasterBrushGestureV3 | null>(null)
  const resourceSizesRef = useRef(new Map<string, number>())
  const committedTilesRef = useRef(new RasterBrushCommittedOverlayCacheV3())
  const [overlay, setOverlay] = useState<RasterBrushOverlayStateV3 | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const activeTool = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.activeTool ?? 'move',
  )
  const selectedLayerIds = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.selectedLayerIds ?? EMPTY_IDS,
  )
  const settings = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.toolSettings,
  )
  const geometry = useMemo(
    () => resolveAnnotationOutputGeometryV3(controller.document),
    [controller.document],
  )
  const brushTool = activeTool === 'raster-brush'
    || activeTool === 'eraser'
    || activeTool === 'mask-edit'
  const selectedLayerIdsKey = selectedLayerIds.join('\u0000')

  useEffect(() => {
    for (const [resourceId, byteSize] of Object.entries(resourceByteSizes ?? {})) {
      resourceSizesRef.current.set(resourceId, byteSize)
    }
  }, [resourceByteSizes])

  const resolveCommittedOverlay = useCallback((): RasterBrushOverlayStateV3 | null => {
    const document = bus.getSnapshot().document
    committedTilesRef.current.discardOtherDocuments(document.id)
    if (!brushTool) return null
    const resolved = resolveImageEditorBrushEditingTargetV3({
      document,
      selectedLayerIds,
      activeTool,
      maskMode: settings?.maskMode ?? 'paint',
      resourceByteSizes: resourceSizesRef.current,
    })
    if (!resolved.ready) return null
    const tiles = committedTilesRef.current.tilesForLayer({
      documentId: document.id,
      layerId: resolved.target.cacheId,
      tileResources: resolved.target.tileResources,
    })
    return tiles.size > 0 ? { matrix: resolved.target.matrix, tiles } : null
  }, [activeTool, brushTool, bus, selectedLayerIds, settings?.maskMode])

  const refreshCommittedOverlay = useCallback((): void => {
    setOverlay(resolveCommittedOverlay())
  }, [resolveCommittedOverlay])

  useEffect(() => {
    const document = bus.getSnapshot().document
    committedTilesRef.current.discardOtherDocuments(document.id)
    if (
      basePreviewDocumentId === document.id
      && basePreviewRevision !== null
    ) {
      committedTilesRef.current.releaseThrough(document.id, basePreviewRevision)
    }
    if (!gestureRef.current) refreshCommittedOverlay()
  }, [
    basePreviewDocumentId,
    basePreviewRevision,
    bus,
    controller.document,
    refreshCommittedOverlay,
    selectedLayerIdsKey,
  ])

  const clientToLayer = useCallback((
    inverseMatrix: AnnotationMatrixV3,
    clientX: number,
    clientY: number,
  ): readonly [number, number] => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return [0, 0]
    const outputPoint: readonly [number, number] = [
      (clientX - rect.left) / rect.width * geometry.width,
      (clientY - rect.top) / rect.height * geometry.height,
    ]
    return mapAnnotationPointV3(inverseMatrix, outputPoint)
  }, [geometry.height, geometry.width])

  const samplesToPoints = useCallback((
    current: ActiveRasterBrushGestureV3,
    samples: readonly (PointerEvent | ReactPointerEvent<SVGSVGElement>)[],
  ): ImageEditBrushPointV3[] => samples.map((sample) => {
    const [x, y] = clientToLayer(current.inverseMatrix, sample.clientX, sample.clientY)
    return {
      x,
      y,
      screenX: sample.clientX,
      screenY: sample.clientY,
      pressure: pressureOf(sample),
    }
  }), [clientToLayer])

  const cancelGesture = useCallback((): void => {
    const current = gestureRef.current
    if (!current) return
    gestureRef.current = null
    releaseEditorPointerV3(current.pointer)
    current.queue.stop()
    current.stroke.cancel()
    refreshCommittedOverlay()
  }, [refreshCommittedOverlay])

  useEffect(() => {
    return () => {
      const current = gestureRef.current
      gestureRef.current = null
      if (!current) return
      releaseEditorPointerV3(current.pointer)
      current.queue.stop()
      current.stroke.cancel()
    }
  }, [])

  useEffect(() => {
    const current = gestureRef.current
    if (!current) {
      if (!brushTool) setFailure(null)
      return
    }
    const document = bus.getSnapshot().document
    const documentChanged = document.id !== current.documentId
      || (
        document.revision !== current.documentRevision
        && document.revision !== current.committedRevision
      )
    if (
      !brushTool
      || activeTool !== current.tool
      || selectedLayerIdsKey !== current.selectedLayerIdsKey
      || documentChanged
    ) {
      cancelGesture()
      if (!brushTool) setFailure(null)
    }
  }, [
    activeTool,
    bus,
    cancelGesture,
    controller.document.id,
    controller.document.revision,
    brushTool,
    selectedLayerIdsKey,
  ])

  const moveGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gestureRef.current
    if (
      !current
      || current.phase !== 'drawing'
      || !matchesEditorPointerV3(current.pointer, event.pointerId)
    ) return
    const native = event.nativeEvent
    const samples = native.getCoalescedEvents?.() ?? [event]
    current.queue.enqueue(samplesToPoints(current, samples))
  }

  const finishGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gestureRef.current
    if (
      !current
      || current.phase !== 'drawing'
      || !matchesEditorPointerV3(current.pointer, event.pointerId)
    ) return
    current.phase = 'finishing'
    current.queue.enqueue(samplesToPoints(current, [event]))
    void (async () => {
      let committed = false
      try {
        await current.queue.flush()
        committed = Boolean(await current.stroke.finish())
        if (gestureRef.current === current) setFailure(null)
      } catch (error) {
        current.stroke.cancel()
        if (gestureRef.current === current) {
          setFailure(t('imageEditor.v3.rasterBrush.failed', { reason: errorMessage(error) }))
        }
      } finally {
        current.queue.stop()
        if (gestureRef.current === current) {
          gestureRef.current = null
          releaseEditorPointerV3(current.pointer)
          if (committed) refreshCommittedOverlay()
          else setOverlay(resolveCommittedOverlay())
        }
      }
    })()
  }

  const cancelPointerGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gestureRef.current
    if (!current || !matchesEditorPointerV3(current.pointer, event.pointerId)) return
    cancelGesture()
  }

  const handleLostPointerCapture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gestureRef.current
    if (
      !current
      || current.phase !== 'drawing'
      || !matchesEditorPointerV3(current.pointer, event.pointerId)
    ) return
    cancelGesture()
  }

  const startGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!brushTool || event.button !== 0 || gestureRef.current) return
    const document = bus.getSnapshot().document
    const resolved = resolveImageEditorBrushEditingTargetV3({
      document,
      selectedLayerIds,
      activeTool,
      maskMode: settings?.maskMode ?? 'paint',
      resourceByteSizes: resourceSizesRef.current,
    })
    if (!resolved.ready) {
      setFailure(t(`imageEditor.v3.rasterBrush.${resolved.reason}`))
      return
    }
    const target = resolved.target
    const { matrix, inverseMatrix } = target
    setFailure(null)
    const existingTiles = committedTilesRef.current.tilesForLayer({
      documentId: document.id,
      layerId: target.cacheId,
      tileResources: target.tileResources,
    })
    setOverlay({ matrix, tiles: existingTiles })
    const tool = activeTool as ImageEditorBrushToolIdV3
    const stroke = new ImageEditorRasterBrushStrokeV3({
      bus,
      document,
      layerId: target.layerId,
      destination: target.destination,
      tool: target.tool,
      shape: {
        size: settings?.brushSize ?? 32,
        opacity: settings?.brushOpacity ?? 1,
        hardness: settings?.brushHardness ?? 0.8,
      },
      target: target.target,
      loadTile: target.loadTile,
      resourceByteSizes: resourceSizesRef.current,
      onPreviewTiles: (changes) => setOverlay((current) => {
        const tiles = new Map(current?.tiles ?? [])
        for (const change of changes) tiles.set(change.tileKey, change)
        return { matrix, tiles }
      }),
      onCommittedTiles: (changes, persisted) => {
        const revision = bus.getSnapshot().document.revision
        committedTilesRef.current.commit({
          documentId: document.id,
          layerId: target.cacheId,
          revision,
          changes,
          persisted,
        })
        const current = gestureRef.current
        if (current?.stroke === stroke) {
          current.committedRevision = revision
        }
      },
    })
    stroke.begin()
    const current: ActiveRasterBrushGestureV3 = {
      stroke,
      inverseMatrix,
      queue: new ImageEditorRasterBrushInputQueueV3((points) => stroke.append(points)),
      pointer: captureEditorPointerV3(event.currentTarget, event.pointerId),
      documentId: document.id,
      documentRevision: document.revision,
      selectedLayerIdsKey,
      tool,
      phase: 'drawing',
    }
    gestureRef.current = current
    current.queue.enqueue(samplesToPoints(current, [event]))
    event.preventDefault()
  }

  if (!brushTool && !failure && !overlay) return null
  return (
    <>
      {brushTool || overlay ? (
        /* icon-token-allow: 这是按图片像素坐标编辑瓦片的 SVG 画布，不是界面图标。 */
        <svg
          ref={svgRef}
          data-raster-brush-overlay
          aria-label={t('imageEditor.v3.rasterBrush.overlay')}
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          preserveAspectRatio="none"
          className={`absolute inset-0 h-full w-full touch-none ${brushTool ? 'pointer-events-auto' : 'pointer-events-none'}`}
          onPointerDown={startGesture}
          onPointerMove={moveGesture}
          onPointerUp={finishGesture}
          onPointerCancel={cancelPointerGesture}
          onLostPointerCapture={handleLostPointerCapture}
        >
          {overlay ? (
            <g transform={annotationMatrixToSvgV3(overlay.matrix)} pointerEvents="none">
              {[...overlay.tiles.values()].map((change) => (
                <foreignObject
                  key={change.tileKey}
                  x={change.coordinate.x * 512}
                  y={change.coordinate.y * 512}
                  width={change.tile.width}
                  height={change.tile.height}
                >
                  <RasterBrushTileCanvasV3 change={change} />
                </foreignObject>
              ))}
            </g>
          ) : null}
        </svg>
      ) : null}
      {failure ? (
        <div
          role="alert"
          className="ui-glass pointer-events-none absolute left-1/2 top-3 max-w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg px-3 py-2 text-xs text-text-dark"
        >
          {failure}
        </div>
      ) : null}
    </>
  )
}
