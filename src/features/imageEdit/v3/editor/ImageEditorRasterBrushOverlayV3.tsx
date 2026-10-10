import { UiError, UiPanel } from '@/components/ui'
import { PaintWorkerClient } from '../tools/paint/workerClient'
import { createPaintSelectionClip } from '../tools/paint/selectionClip'
import { imageEditPaintBrushV3 } from '../tools/paint/settings'
import { RetouchStrokeCompute } from '../tools/retouch/source'
import { RetouchSourcePreview } from '../tools/retouch/RetouchSourcePreview'
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
  selectionRevision: number
  documentRevision: number
  selectedLayerIdsKey: string
  tool: ImageEditorBrushToolIdV3
  phase: 'drawing' | 'finishing'
  committedRevision?: number
  disposeCompute: () => void
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

import type { ToolPointerAvailabilityBinding } from '../toolFramework/types'

export function ImageEditorRasterBrushOverlayV3({
  bus,
  controller,
  resourceByteSizes,
  basePreviewDocumentId,
  basePreviewRevision,
  bindPointerAvailability,
}: {
  bindPointerAvailability?: ToolPointerAvailabilityBinding
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
  const [hoverPoint, setHoverPoint] = useState<readonly [number, number] | null>(null)
  const activeTool = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.activeTool ?? 'move',
  )
  const selectedLayerIds = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.selectedLayerIds ?? EMPTY_IDS,
  )
  const editTarget = useImageEditorSessionStoreV3(state => state.sessions[controller.sessionId]?.editTarget ?? 'pixels')
  const settings = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.toolSettings,
  )
  const geometry = useMemo(
    () => resolveAnnotationOutputGeometryV3(controller.document),
    [controller.document],
  )
  const retouchTool = activeTool === 'clone-stamp' || activeTool === 'healing-brush'
  const brushTool = retouchTool || activeTool === 'raster-brush'
    || activeTool === 'eraser'
    || activeTool === 'mask-edit'
  const selectedLayerIdsKey = selectedLayerIds.join('\u0000') + editTarget + (settings?.maskMode ?? '')
  const donorTarget = useMemo(() => retouchTool ? resolveImageEditorBrushEditingTargetV3({ document: controller.document, selectedLayerIds, activeTool,
    maskMode: 'paint', editTarget, resourceByteSizes: resourceSizesRef.current }) : null, [retouchTool, controller.document, selectedLayerIds, activeTool, editTarget])
  const donorSize = useCallback(async () => controller.document.geometry, [controller.document.geometry])
  const donorFailure = useCallback((error: unknown) => setFailure(t('imageEditor.v3.rasterBrush.failed', { reason: errorMessage(error) })), [t])
  const sourcePoint = settings?.retouchSource && settings.retouchSource.documentId === controller.document.id && selectedLayerIds.includes(settings.retouchSource.layerId)
    ? hoverPoint && settings.retouchOffset && (settings.retouchAligned || gestureRef.current)
      ? [hoverPoint[0] + settings.retouchOffset.x, hoverPoint[1] + settings.retouchOffset.y] as const
      : [settings.retouchSource.x, settings.retouchSource.y] as const : null

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
      editTarget, color: settings?.paintColor, maskValue: settings?.paintMaskValue,
      resourceByteSizes: resourceSizesRef.current,
    })
    if (!resolved.ready) return null
    const tiles = committedTilesRef.current.tilesForLayer({
      documentId: document.id,
      layerId: resolved.target.cacheId,
      tileResources: resolved.target.tileResources,
    })
    return tiles.size > 0 ? { matrix: resolved.target.matrix, tiles } : null
  }, [activeTool, brushTool, bus, selectedLayerIds, settings?.maskMode, editTarget, settings?.paintColor, settings?.paintMaskValue])

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
      tiltX: sample.tiltX ?? 0, tiltY: sample.tiltY ?? 0,
    }
  }), [clientToLayer])

  const cancelGesture = useCallback((): void => {
    const current = gestureRef.current
    if (!current) return
    gestureRef.current = null
    releaseEditorPointerV3(current.pointer)
    current.queue.stop()
    current.stroke.cancel()
    current.disposeCompute()
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
      current.disposeCompute()
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

  useEffect(() => bus.subscribe(() => {
    const current = gestureRef.current
    if (current && bus.getSnapshot().selectionRevision !== current.selectionRevision) cancelGesture()
  }), [bus, cancelGesture])

  useEffect(() => bindPointerAvailability?.('raster', () => !gestureRef.current), [bindPointerAvailability])

  const moveGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gestureRef.current
    if (retouchTool) {
      const resolved = resolveImageEditorBrushEditingTargetV3({ document: bus.getSnapshot().document, selectedLayerIds, activeTool,
        maskMode: 'paint', editTarget, resourceByteSizes: resourceSizesRef.current })
      if (resolved.ready) setHoverPoint(clientToLayer(resolved.target.inverseMatrix, event.clientX, event.clientY))
    }
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
        current.disposeCompute()
        if (gestureRef.current === current) {
          setFailure(t('imageEditor.v3.rasterBrush.failed', { reason: errorMessage(error) }))
        }
      } finally {
        current.queue.stop()
        current.disposeCompute()
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
      editTarget, color: settings?.paintColor, maskValue: settings?.paintMaskValue,
      resourceByteSizes: resourceSizesRef.current,
    })
    if (!resolved.ready) {
      setFailure(t(`imageEditor.v3.rasterBrush.${resolved.reason}`))
      return
    }
    const target = resolved.target
    const { matrix, inverseMatrix } = target
    const first = clientToLayer(inverseMatrix, event.clientX, event.clientY)
    const store = useImageEditorSessionStoreV3.getState()
    if (retouchTool && (event.altKey || settings?.retouchPicking)) {
      store.setToolSetting(controller.sessionId, 'retouchSource', { documentId: document.id, layerId: target.layerId, x: first[0], y: first[1] })
      store.setToolSetting(controller.sessionId, 'retouchOffset', null)
      store.setToolSetting(controller.sessionId, 'retouchPicking', false)
      setFailure(null); event.preventDefault(); return
    }
    const source = settings?.retouchSource
    if (retouchTool && (!source || source.documentId !== document.id || source.layerId !== target.layerId)) {
      setFailure(t('imageEditor.v3.retouch.sampleFirst')); return
    }
    setFailure(null)
    const existingTiles = committedTilesRef.current.tilesForLayer({
      documentId: document.id,
      layerId: target.cacheId,
      tileResources: target.tileResources,
    })
    setOverlay({ matrix, tiles: existingTiles })
    const tool = activeTool as ImageEditorBrushToolIdV3
    const offset = settings?.retouchAligned && settings.retouchOffset ? settings.retouchOffset : source ? { x: source.x - first[0], y: source.y - first[1] } : { x: 0, y: 0 }
    if (retouchTool) store.setToolSetting(controller.sessionId, 'retouchOffset', offset)
    const clip = createPaintSelectionClip(document, bus.getSnapshot().selection, matrix, target.resolveStorageSize ?? (async () => document.geometry))
    const compute = retouchTool ? new RetouchStrokeCompute(target.loadTile, target.resolveStorageSize ?? (async () => document.geometry), activeTool === 'clone-stamp' ? 'clone' : 'heal', offset, clip.read) : new PaintWorkerClient()
    const stroke = new ImageEditorRasterBrushStrokeV3({
      bus,
      document,
      layerId: target.layerId,
      destination: target.destination,
      tool: target.tool,
      shape: settings ? imageEditPaintBrushV3(settings) : { size: 32, opacity: 1, hardness: .8 },
      rasterize: compute.rasterize,
      loadCoverage: clip.read,
      target: target.target,
      loadTile: target.loadTile,
      resolveStorageSize: target.resolveStorageSize,
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
      selectionRevision: bus.getSnapshot().selectionRevision,
      selectedLayerIdsKey,
      tool,
      phase: 'drawing',
      disposeCompute: () => { compute.dispose(); clip.dispose() },
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
          {retouchTool && settings?.retouchShowSource && sourcePoint && donorTarget?.ready ? <>
            {hoverPoint && !gestureRef.current && !settings.retouchPicking ? <RetouchSourcePreview load={donorTarget.target.loadTile}
              size={donorTarget.target.resolveStorageSize ?? donorSize} source={sourcePoint} destination={hoverPoint} diameter={settings.brushSize}
              matrix={donorTarget.target.matrix} document={controller.document} onError={donorFailure} /> : null}
            {(() => {
              const mapped = mapAnnotationPointV3(donorTarget.target.matrix, sourcePoint), radius = geometry.width / 80
              return <g pointerEvents="none" className="fill-none stroke-accent-text" data-retouch-source-marker>
                <circle cx={mapped[0]} cy={mapped[1]} r={radius} strokeWidth={geometry.width / 500} />
                <path d={`M ${mapped[0] - radius * 1.5} ${mapped[1]} H ${mapped[0] + radius * 1.5} M ${mapped[0]} ${mapped[1] - radius * 1.5} V ${mapped[1] + radius * 1.5}`} strokeWidth={geometry.width / 500} />
              </g>
            })()}
          </> : null}
        </svg>
      ) : null}
      {failure ? <UiPanel className="absolute left-1/2 top-3 max-w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 px-4"><UiError size="sm" message={failure} /></UiPanel> : null}
    </>
  )
}
