import { AlertTriangle, LoaderCircle, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

import { UiIconButton } from '@/components/ui'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import {
  useImageEditorInteractionStoreV3,
  useImageEditorSessionStoreV3,
} from '../store'
import {
  useImageEditorViewportCompositeV3,
  useManagedImageEditorPreviewV3,
} from '../execution'
import { ImageEditorAnnotationOverlayV3 } from './ImageEditorAnnotationOverlayV3'
import { ImageEditorRasterBrushOverlayV3 } from './ImageEditorRasterBrushOverlayV3'
import { ImageEditorViewportTilesV3 } from './ImageEditorViewportTilesV3'
import { resolveAnnotationOutputGeometryV3 } from './annotationGeometryV3'
import type {
  ImageEditorV3Controller,
  ImageEditorV3PreviewOutput,
  ImageEditorV3Props,
} from './types'
import { useImageEditorBusSnapshotV3 } from './useImageEditorControllerV3'
import { useImageEditorViewportLayoutV3 } from './useImageEditorViewportLayoutV3'
import {
  imageEditorViewportTransformV3,
  zoomImageEditorViewportAroundPointV3,
  type ImageEditorViewportPanV3,
} from './viewportNavigationV3'

interface ImageEditorPreviewV3Props extends Pick<
  ImageEditorV3Props,
  | 'sourceImageUrl'
  | 'previewRenderer'
  | 'annotationOverlay'
  | 'resourceByteSizes'
  | 'resourceDescriptors'
> {
  bus: ImageEditCommandBusV3
  controller: ImageEditorV3Controller
}

interface ImageEditorViewportGestureV3 {
  kind: 'pan' | 'zoom'
  pointerId: number
  startClientX: number
  startClientY: number
  startPan: ImageEditorViewportPanV3
  pendingPan: ImageEditorViewportPanV3
  altKey: boolean
  moved: boolean
}

const ZERO_VIEWPORT_PAN_V3: ImageEditorViewportPanV3 = { x: 0, y: 0 }

function FramePreview({ output, label }: { output: Extract<ImageEditorV3PreviewOutput, { kind: 'frame' }>; label: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const releasedOutputRef = useRef<typeof output | null>(null)

  useEffect(() => {
    try {
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = output.width
        canvas.height = output.height
        const context = canvas.getContext('2d')
        context?.clearRect(0, 0, output.width, output.height)
        context?.drawImage(output.frame, 0, 0, output.width, output.height)
      }
    } finally {
      if (releasedOutputRef.current !== output) {
        output.release?.()
        releasedOutputRef.current = output
      }
    }
  }, [output])

  return <canvas ref={canvasRef} role="img" aria-label={label} className="block max-h-full max-w-full" />
}

function UrlPreview({ output, label }: {
  output: Extract<ImageEditorV3PreviewOutput, { kind: 'url' }>
  label: string
}): JSX.Element {
  const { release, url } = output
  useEffect(() => () => release?.(), [release, url])
  return (
    <img
      src={url}
      alt={label}
      className="block max-h-full max-w-full select-none object-contain"
      draggable={false}
    />
  )
}

export function ImageEditorPreviewV3({
  sourceImageUrl,
  previewRenderer,
  annotationOverlay,
  resourceByteSizes,
  resourceDescriptors,
  bus,
  controller,
}: ImageEditorPreviewV3Props): JSX.Element {
  const { t } = useTranslation('ui')
  const surfaceRef = useRef<HTMLElement | null>(null)
  const viewportContentRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<ImageEditorViewportGestureV3 | null>(null)
  const snapshot = useImageEditorBusSnapshotV3(bus)
  const activeTool = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.activeTool ?? 'move',
  )
  const zoom = useImageEditorInteractionStoreV3(
    (state) => state.viewportZoomBySession[controller.sessionId] ?? 1,
  )
  const pan = useImageEditorInteractionStoreV3(
    (state) => state.viewportPanBySession[controller.sessionId] ?? ZERO_VIEWPORT_PAN_V3,
  )
  const setViewportPan = useImageEditorInteractionStoreV3((state) => state.setViewportPan)
  const setViewportTransform = useImageEditorInteractionStoreV3(
    (state) => state.setViewportTransform,
  )
  const outputGeometry = useMemo(
    () => resolveAnnotationOutputGeometryV3(snapshot.document),
    [snapshot.document],
  )
  const viewportLayout = useImageEditorViewportLayoutV3(
    surfaceRef,
    outputGeometry,
    zoom,
    pan,
  )

  const managedPreview = useManagedImageEditorPreviewV3(
    controller.sessionId,
    snapshot,
    !previewRenderer,
    resourceDescriptors,
  )
  const viewportComposite = useImageEditorViewportCompositeV3(
    controller.sessionId,
    snapshot,
    !previewRenderer && Object.keys(snapshot.previewOverrides).length === 0,
    resourceDescriptors,
    viewportLayout,
  )
  const viewportResult = viewportComposite.result
    && viewportLayout
    && viewportComposite.result.viewportKey === viewportLayout.viewportKey
    && viewportComposite.result.documentId === snapshot.document.id
    && viewportComposite.result.revision === snapshot.document.revision
    ? viewportComposite.result
    : null

  const customOutput = useMemo<ImageEditorV3PreviewOutput | null>(() => previewRenderer?.({
    sourceImageUrl,
    snapshot,
    activeTool,
    sessionId: controller.sessionId,
  }) ?? null, [
    activeTool,
    previewRenderer,
    controller.sessionId,
    snapshot,
    sourceImageUrl,
  ])
  // 受管帧的 output 身份只能随受管 result 改变；文档或工具重渲染期间仍保留的
  // 同一 result 已在首次 draw 后释放，不能再包一层新对象后重复 draw/release。
  const managedOutput = useMemo<ImageEditorV3PreviewOutput>(() => (
    managedPreview.result?.kind === 'bitmap'
      ? {
          kind: 'frame' as const,
          frame: managedPreview.result.bitmap,
          width: managedPreview.result.width,
          height: managedPreview.result.height,
          release: managedPreview.result.release,
        }
      : managedPreview.result?.kind === 'url'
        ? {
            kind: 'url' as const,
            url: managedPreview.result.url,
            release: managedPreview.result.release,
          }
        : { kind: 'content', content: null }
  ), [managedPreview.result])
  const output = customOutput ?? managedOutput
  const basePreviewDocumentId = previewRenderer
    ? snapshot.document.id
    : viewportResult?.documentId ?? managedPreview.resultDocumentId
  const basePreviewRevision = previewRenderer
    ? snapshot.document.revision
    : viewportResult?.revision ?? managedPreview.resultRevision

  const applyViewportTransform = useCallback((
    nextZoom: number,
    nextPan: ImageEditorViewportPanV3,
  ): void => {
    const content = viewportContentRef.current
    if (content) content.style.transform = imageEditorViewportTransformV3(nextZoom, nextPan)
  }, [])

  useEffect(() => {
    if (!gestureRef.current) applyViewportTransform(zoom, pan)
  }, [applyViewportTransform, pan, zoom])

  const zoomAroundClientPoint = useCallback((
    clientX: number,
    clientY: number,
    requestedZoom: number,
  ): void => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const next = zoomImageEditorViewportAroundPointV3(zoom, pan, requestedZoom, {
      x: clientX - (rect.left + rect.width / 2),
      y: clientY - (rect.top + rect.height / 2),
    })
    setViewportTransform(controller.sessionId, next)
  }, [controller.sessionId, pan, setViewportTransform, zoom])

  const releaseGesture = useCallback((commit: boolean): void => {
    const gesture = gestureRef.current
    if (!gesture) return
    gestureRef.current = null
    const surface = surfaceRef.current
    if (
      surface
      && typeof surface.hasPointerCapture === 'function'
      && surface.hasPointerCapture(gesture.pointerId)
      && typeof surface.releasePointerCapture === 'function'
    ) {
      surface.releasePointerCapture(gesture.pointerId)
    }
    if (viewportContentRef.current) viewportContentRef.current.style.willChange = ''
    if (commit && gesture.kind === 'pan') {
      setViewportPan(controller.sessionId, gesture.pendingPan)
      return
    }
    applyViewportTransform(zoom, pan)
  }, [applyViewportTransform, controller.sessionId, pan, setViewportPan, zoom])

  useEffect(() => {
    const navigationActive = activeTool === 'hand' || activeTool === 'zoom'
    if (!navigationActive) releaseGesture(false)
  }, [activeTool, releaseGesture])

  useEffect(() => () => releaseGesture(false), [releaseGesture])

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (
      event.button !== 0
      || !event.isPrimary
      || (activeTool !== 'hand' && activeTool !== 'zoom')
      || (event.target instanceof Element && event.target.closest('[data-viewport-control]'))
    ) return
    event.preventDefault()
    releaseGesture(false)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 失焦边界由 pointercancel/unmount 继续兜底。
    }
    const gesture: ImageEditorViewportGestureV3 = {
      kind: activeTool === 'hand' ? 'pan' : 'zoom',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPan: { ...pan },
      pendingPan: { ...pan },
      altKey: event.altKey,
      moved: false,
    }
    gestureRef.current = gesture
    if (viewportContentRef.current) viewportContentRef.current.style.willChange = 'transform'
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const deltaX = event.clientX - gesture.startClientX
    const deltaY = event.clientY - gesture.startClientY
    if (deltaX * deltaX + deltaY * deltaY > 9) gesture.moved = true
    if (gesture.kind !== 'pan') return
    event.preventDefault()
    gesture.pendingPan = {
      x: gesture.startPan.x + deltaX,
      y: gesture.startPan.y + deltaY,
    }
    // 高频拖动只写合成层；结束时才向 Zustand 提交一次。
    applyViewportTransform(zoom, gesture.pendingPan)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.preventDefault()
    if (gesture.kind === 'zoom' && !gesture.moved) {
      const requestedZoom = gesture.altKey ? zoom / 1.25 : zoom * 1.25
      gestureRef.current = null
      if (
        typeof event.currentTarget.hasPointerCapture === 'function'
        && event.currentTarget.hasPointerCapture(event.pointerId)
        && typeof event.currentTarget.releasePointerCapture === 'function'
      ) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      if (viewportContentRef.current) viewportContentRef.current.style.willChange = ''
      zoomAroundClientPoint(event.clientX, event.clientY, requestedZoom)
      return
    }
    releaseGesture(true)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLElement>): void => {
    if (activeTool !== 'zoom' && !event.ctrlKey && !event.metaKey) return
    if (event.deltaY === 0) return
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
    zoomAroundClientPoint(event.clientX, event.clientY, zoom * factor)
  }

  const zoomFromCenter = (requestedZoom: number): void => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return
    zoomAroundClientPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      requestedZoom,
    )
  }

  const navigationCursor = activeTool === 'hand'
    ? 'cursor-grab active:cursor-grabbing'
    : activeTool === 'zoom'
      ? 'cursor-zoom-in'
      : ''

  return (
    <main
      ref={surfaceRef}
      data-preview-surface
      data-active-navigation-tool={activeTool === 'hand' || activeTool === 'zoom' ? activeTool : undefined}
      className={`relative min-h-0 min-w-0 flex-1 overflow-hidden bg-bg-dark ${navigationCursor}`}
      style={{ touchAction: activeTool === 'hand' || activeTool === 'zoom' ? 'none' : undefined }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => releaseGesture(false)}
      onWheel={handleWheel}
    >
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-6">
        <div
          ref={viewportContentRef}
          data-viewport-content
          className="relative flex max-h-full max-w-full items-center justify-center origin-center"
          style={{
            transform: imageEditorViewportTransformV3(zoom, pan),
            ...(!previewRenderer && viewportLayout
              ? { width: viewportLayout.stageWidth, height: viewportLayout.stageHeight }
              : {}),
          }}
        >
          {viewportResult ? (
            <ImageEditorViewportTilesV3
              result={viewportResult}
              label={t('imageEditor.v3.previewAlt')}
            />
          ) : null}
          {!viewportResult && output.kind === 'url' ? (
            <UrlPreview output={output} label={t('imageEditor.v3.previewAlt')} />
          ) : null}
          {!viewportResult && output.kind === 'frame' ? (
            <FramePreview output={output} label={t('imageEditor.v3.previewAlt')} />
          ) : null}
          {!viewportResult && output.kind === 'content' ? output.content : null}
          <ImageEditorAnnotationOverlayV3 controller={controller} />
          <ImageEditorRasterBrushOverlayV3
            bus={bus}
            controller={controller}
            resourceByteSizes={resourceByteSizes}
            basePreviewDocumentId={basePreviewDocumentId}
            basePreviewRevision={basePreviewRevision}
          />
          {annotationOverlay ? (
            <div data-annotation-overlay className="pointer-events-none absolute inset-0">
              {annotationOverlay}
            </div>
          ) : null}
        </div>
      </div>
      {!previewRenderer && managedPreview.rendering && !managedPreview.result ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <LoaderCircle className="h-6 w-6 animate-spin text-text-dark-muted" />
        </div>
      ) : null}
      {!previewRenderer && managedPreview.diagnostic ? (
        <div
          role="status"
          className="ui-glass absolute left-1/2 top-3 flex max-w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 items-start gap-2 rounded-lg px-3 py-2 text-xs text-text-dark"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span className="whitespace-pre-line">{managedPreview.diagnostic}</span>
        </div>
      ) : null}
      <div
        data-viewport-control
        className="ui-glass absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg p-1"
      >
        <UiIconButton
          className="h-8 w-8 text-white hover:text-white"
          showBorder={false}
          appearance="hover-only"
          aria-label={t('imageEditor.v3.zoomOut')}
          title={t('imageEditor.v3.zoomOut')}
          disabled={zoom <= 0.05}
          onClick={() => zoomFromCenter(zoom / 1.25)}
        >
          <Minus className="h-4 w-4" />
        </UiIconButton>
        <span className="w-14 text-center text-xs tabular-nums text-white">
          {Math.round(zoom * 100)}%
        </span>
        <UiIconButton
          className="h-8 w-8 text-white hover:text-white"
          showBorder={false}
          appearance="hover-only"
          aria-label={t('imageEditor.v3.zoomIn')}
          title={t('imageEditor.v3.zoomIn')}
          disabled={zoom >= 8}
          onClick={() => zoomFromCenter(zoom * 1.25)}
        >
          <Plus className="h-4 w-4" />
        </UiIconButton>
      </div>
    </main>
  )
}
