import { AlertTriangle, LoaderCircle, Minus, Plus } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { UiIconButton } from '@/components/ui'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import {
  useImageEditorInteractionStoreV3,
  useImageEditorSessionStoreV3,
} from '../store'
import {
  useImageEditorDisplayPipelineV3,
  useImageEditorThumbnailPrefetchV3,
} from '../execution'
import { projectImageEditorPreviewDocumentV3 } from '../execution/previewDocumentV3'
import { useImageEditorResultLeaseV3 } from '../execution/useImageEditorResultLeaseV3'
import { ImageEditorAnnotationOverlayV3 } from './ImageEditorAnnotationOverlayV3'
import {
  ImageEditorFramePreviewV3,
  ImageEditorUrlPreviewV3,
} from './ImageEditorPreviewOutputV3'
import { ImageEditorRasterBrushOverlayV3 } from './ImageEditorRasterBrushOverlayV3'
import { ImageEditorSelectionMaskOverlayV3 } from './ImageEditorSelectionMaskOverlayV3'
import { ImageEditorViewportTilesV3 } from './ImageEditorViewportTilesV3'
import { resolveAnnotationOutputGeometryV3 } from './annotationGeometryV3'
import { ImageEditorCropOverlayV3 } from './ImageEditorCropOverlayV3'
import type {
  ImageEditorV3Controller,
  ImageEditorV3PreviewOutput,
  ImageEditorV3Props,
} from './types'
import { useImageEditorBusSnapshotV3 } from './useImageEditorControllerV3'
import { useImageEditorViewportLayoutV3 } from './useImageEditorViewportLayoutV3'
import { useImageEditorLayerMoveGestureV3 } from './useImageEditorLayerMoveGestureV3'
import { imageEditorViewportTransformV3, type ImageEditorViewportPanV3 } from './viewportNavigationV3'
import { useImageEditorViewportNavigationGestureV3 } from './useImageEditorViewportNavigationGestureV3'
import {
  resolveLiveGaussianBlurRadiusV3,
  splitLiveAnnotationDisplayV3,
} from './liveAnnotationDisplayV3'

interface ImageEditorPreviewV3Props extends Pick<
  ImageEditorV3Props,
  | 'sourceImageUrl'
  | 'previewRenderer'
  | 'annotationOverlay'
  | 'resourceByteSizes'
  | 'resourceDescriptors'
  | 'onPackageThumbnailChange'
> {
  bus: ImageEditCommandBusV3
  controller: ImageEditorV3Controller
}

const ZERO_VIEWPORT_PAN_V3: ImageEditorViewportPanV3 = { x: 0, y: 0 }
const EMPTY_PREVIEW_OVERRIDES_V3 = {}

export function ImageEditorPreviewV3({
  sourceImageUrl,
  previewRenderer,
  annotationOverlay,
  resourceByteSizes,
  resourceDescriptors,
  onPackageThumbnailChange,
  bus,
  controller,
}: ImageEditorPreviewV3Props): JSX.Element {
  const { t } = useTranslation('ui')
  const surfaceRef = useRef<HTMLElement | null>(null)
  const viewportContentRef = useRef<HTMLDivElement | null>(null)
  const moveFeedbackRef = useRef<HTMLDivElement | null>(null)
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
  const projectedDocument = useMemo(
    () => projectImageEditorPreviewDocumentV3(snapshot),
    [snapshot],
  )
  const cropDisplayDocument = useMemo(() => activeTool === 'crop'
    ? {
        ...snapshot.document,
        geometry: {
          ...snapshot.document.geometry,
          orientation: projectedDocument.geometry.orientation,
          crop: null,
        },
      }
    : snapshot.document, [activeTool, projectedDocument.geometry.orientation, snapshot.document])
  const liveDisplay = useMemo(
    () => splitLiveAnnotationDisplayV3(cropDisplayDocument),
    [cropDisplayDocument],
  )
  const baseDocumentCandidate = activeTool === 'crop' || previewRenderer
    ? cropDisplayDocument
    : liveDisplay.baseDocument
  const baseIdentity = activeTool === 'crop' || previewRenderer
    ? `${baseDocumentCandidate.id}:${baseDocumentCandidate.revision}`
    : liveDisplay.baseIdentity
  const stableBaseDocumentRef = useRef<{
    identity: string
    document: typeof baseDocumentCandidate
    history: typeof snapshot.history
  } | null>(null)
  if (stableBaseDocumentRef.current?.identity !== baseIdentity) {
    stableBaseDocumentRef.current = {
      identity: baseIdentity,
      document: baseDocumentCandidate,
      history: snapshot.history,
    }
  }
  const baseDisplayDocument = stableBaseDocumentRef.current.document
  const baseDisplayHistory = stableBaseDocumentRef.current.history
  const basePreviewOverrides = activeTool === 'crop'
    ? EMPTY_PREVIEW_OVERRIDES_V3
    : Object.keys(snapshot.previewOverrides).length === 0
      ? EMPTY_PREVIEW_OVERRIDES_V3
      : snapshot.previewOverrides
  const displaySnapshot = useMemo(() => ({
    document: baseDisplayDocument,
    previewOverrides: basePreviewOverrides,
    history: baseDisplayHistory,
  }), [baseDisplayDocument, baseDisplayHistory, basePreviewOverrides])
  const outputGeometry = useMemo(
    () => resolveAnnotationOutputGeometryV3(cropDisplayDocument),
    [cropDisplayDocument],
  )
  const viewportLayout = useImageEditorViewportLayoutV3(
    surfaceRef,
    outputGeometry,
    zoom,
    pan,
  )
  const layerMoveHandlers = useImageEditorLayerMoveGestureV3(
    controller,
    activeTool,
    viewportContentRef,
    moveFeedbackRef,
    outputGeometry,
    zoom,
  )

  const displayPipeline = useImageEditorDisplayPipelineV3(
    controller.sessionId,
    displaySnapshot,
    !previewRenderer,
    resourceDescriptors,
    viewportLayout,
  )
  const { managedPreview, viewportComposite, viewportResult } = displayPipeline
  const thumbnailDisplayReady = Boolean(
    viewportResult
      && viewportResult.documentId === displaySnapshot.document.id
      && viewportResult.revision === displaySnapshot.document.revision,
  ) || Boolean(
    managedPreview.result
      && managedPreview.resultDocumentId === displaySnapshot.document.id
      && managedPreview.resultRevision === displaySnapshot.document.revision,
  )
  useImageEditorThumbnailPrefetchV3(
    controller.sessionId,
    snapshot,
    !previewRenderer
      && activeTool !== 'crop'
      && Object.keys(snapshot.previewOverrides).length === 0
      && thumbnailDisplayReady,
    resourceDescriptors ?? [],
    onPackageThumbnailChange,
  )
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
  const customResourceIdentity = customOutput?.kind === 'frame'
    ? customOutput.frame
    : customOutput?.kind === 'url'
      ? customOutput.url
      : null
  const customResourceRelease = customOutput
    && 'release' in customOutput
    && typeof customOutput.release === 'function'
    ? customOutput.release
    : undefined
  const customReleasableOutput = useMemo(() => (
    customResourceIdentity && customResourceRelease
      ? { release: customResourceRelease }
      : null
  ), [customResourceIdentity, customResourceRelease])
  useImageEditorResultLeaseV3(customReleasableOutput)
  // 受管帧的 output 身份只能随受管 result 改变，资源租约由受管 Hook 持有。
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
  const basePreviewExact = basePreviewDocumentId === displaySnapshot.document.id
    && basePreviewRevision === displaySnapshot.document.revision
    && (Object.keys(displaySnapshot.previewOverrides).length === 0
      || managedPreview.resultPreviewOverrides === displaySnapshot.previewOverrides)
  const projectedBaseDocument = useMemo(
    () => projectImageEditorPreviewDocumentV3(displaySnapshot),
    [displaySnapshot],
  )
  const pendingBlurRadius = !basePreviewExact && activeTool !== 'crop'
    ? resolveLiveGaussianBlurRadiusV3(projectedBaseDocument)
    : null
  const blurCssPixels = pendingBlurRadius && viewportLayout
    ? Math.min(48, pendingBlurRadius * viewportLayout.stageWidth / Math.max(1, outputGeometry.width))
    : 0
  const blurFeedbackScale = blurCssPixels > 0 && viewportLayout
    ? 1 + Math.min(0.12, blurCssPixels * 4 / Math.max(1, Math.min(
        viewportLayout.stageWidth,
        viewportLayout.stageHeight,
      )))
    : 1

  useLayoutEffect(() => {
    const feedback = moveFeedbackRef.current
    if (!feedback) return
    if (
      Object.keys(snapshot.previewOverrides).length > 0
      || basePreviewDocumentId !== displaySnapshot.document.id
      || basePreviewRevision !== displaySnapshot.document.revision
    ) return
    feedback.style.transform = ''
  }, [basePreviewDocumentId, basePreviewRevision, displaySnapshot.document.id, displaySnapshot.document.revision, snapshot.previewOverrides])

  const navigation = useImageEditorViewportNavigationGestureV3(
    controller.sessionId,
    activeTool,
    surfaceRef,
    viewportContentRef,
    zoom,
    pan,
  )

  const navigationCursor = activeTool === 'hand'
    ? 'cursor-grab active:cursor-grabbing'
    : activeTool === 'zoom'
      ? 'cursor-zoom-in'
      : activeTool === 'move'
        ? layerMoveHandlers.unavailableReason ? 'cursor-not-allowed' : 'cursor-move'
        : ''

  return (
    <main
      ref={surfaceRef}
      data-preview-surface
      data-preview-display-source={previewRenderer ? 'custom' : displayPipeline.displaySource}
      data-active-navigation-tool={activeTool === 'hand' || activeTool === 'zoom' ? activeTool : undefined}
      data-move-availability={activeTool === 'move'
        ? layerMoveHandlers.unavailableReason ?? 'ready'
        : undefined}
      className={`relative min-h-0 min-w-0 flex-1 overflow-hidden bg-bg-dark ${navigationCursor}`}
      style={{ touchAction: activeTool === 'hand' || activeTool === 'zoom' || activeTool === 'move' ? 'none' : undefined }}
      onPointerDownCapture={layerMoveHandlers.onPointerDownCapture}
      onPointerMoveCapture={layerMoveHandlers.onPointerMoveCapture}
      onPointerUpCapture={layerMoveHandlers.onPointerUpCapture}
      onPointerCancelCapture={layerMoveHandlers.onPointerCancelCapture}
      onPointerDown={navigation.onPointerDown}
      onPointerMove={navigation.onPointerMove}
      onPointerUp={navigation.onPointerUp}
      onPointerCancel={navigation.onPointerCancel}
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
          {!previewRenderer ? (
            <div
              data-raster-display-frame
              className="pointer-events-none absolute inset-0 overflow-hidden"
            >
              <div
                ref={moveFeedbackRef}
                data-move-feedback-frame
                className="absolute inset-0 flex items-center justify-center"
              >
                <div
                  data-live-effect-feedback
                  className="absolute inset-0 flex items-center justify-center"
                  style={blurCssPixels > 0 ? {
                    filter: `blur(${blurCssPixels}px)`,
                    transform: `scale(${blurFeedbackScale})`,
                  } : undefined}
                >
                  {viewportResult ? (
                    <ImageEditorViewportTilesV3
                      result={viewportResult}
                      label={t('imageEditor.v3.previewAlt')}
                    />
                  ) : null}
                  {!viewportResult && output.kind === 'url' ? (
                    <ImageEditorUrlPreviewV3 output={output} label={t('imageEditor.v3.previewAlt')} />
                  ) : null}
                  {!viewportResult && output.kind === 'frame' ? (
                    <ImageEditorFramePreviewV3 output={output} label={t('imageEditor.v3.previewAlt')} />
                  ) : null}
                  {!viewportResult && output.kind === 'content' ? output.content : null}
                </div>
              </div>
            </div>
          ) : output.kind === 'url' ? (
            <ImageEditorUrlPreviewV3 output={output} label={t('imageEditor.v3.previewAlt')} />
          ) : output.kind === 'frame' ? (
            <ImageEditorFramePreviewV3 output={output} label={t('imageEditor.v3.previewAlt')} />
          ) : output.content}
          {activeTool === 'crop' && viewportLayout ? (
            <ImageEditorCropOverlayV3
              controller={controller}
              projectedDocument={projectedDocument}
              geometry={outputGeometry}
              stageWidth={viewportLayout.stageWidth}
              stageHeight={viewportLayout.stageHeight}
            />
          ) : null}
          <ImageEditorAnnotationOverlayV3 controller={controller} />
          <ImageEditorRasterBrushOverlayV3
            bus={bus}
            controller={controller}
            resourceByteSizes={resourceByteSizes}
            basePreviewDocumentId={basePreviewDocumentId}
            basePreviewRevision={basePreviewRevision}
          />
          <ImageEditorSelectionMaskOverlayV3
            bus={bus}
            controller={controller}
            resourceByteSizes={resourceByteSizes}
          />
          {annotationOverlay ? (
            <div data-annotation-overlay className="pointer-events-none absolute inset-0">
              {annotationOverlay}
            </div>
          ) : null}
        </div>
      </div>
      {!previewRenderer
        && (managedPreview.rendering || viewportComposite.rendering)
        && !viewportResult
        && !managedPreview.result ? (
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
      {activeTool === 'move' && layerMoveHandlers.unavailableReason ? (
        <div
          role="status"
          className="ui-glass pointer-events-none absolute left-1/2 top-3 flex max-w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 items-start gap-2 rounded-lg px-3 py-2 text-xs text-text-dark"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span>{t(`imageEditor.v3.moveTool.${layerMoveHandlers.unavailableReason}`)}</span>
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
          onClick={() => navigation.zoomFromCenter(zoom / 1.25)}
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
          onClick={() => navigation.zoomFromCenter(zoom * 1.25)}
        >
          <Plus className="h-4 w-4" />
        </UiIconButton>
      </div>
    </main>
  )
}
