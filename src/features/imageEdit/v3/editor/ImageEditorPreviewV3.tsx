import { AlertTriangle, LoaderCircle, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { UiIconButton } from '@/components/ui'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import {
  useImageEditorInteractionStoreV3,
  useImageEditorSessionStoreV3,
} from '../store'
import { useManagedImageEditorPreviewV3 } from '../execution'
import { ImageEditorAnnotationOverlayV3 } from './ImageEditorAnnotationOverlayV3'
import { ImageEditorRasterBrushOverlayV3 } from './ImageEditorRasterBrushOverlayV3'
import type {
  ImageEditorV3Controller,
  ImageEditorV3PreviewOutput,
  ImageEditorV3Props,
} from './types'
import { useImageEditorBusSnapshotV3 } from './useImageEditorControllerV3'

interface ImageEditorPreviewV3Props extends Pick<
  ImageEditorV3Props,
  'sourceImageUrl' | 'previewRenderer' | 'annotationOverlay' | 'resourceByteSizes'
> {
  bus: ImageEditCommandBusV3
  controller: ImageEditorV3Controller
}

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
  bus,
  controller,
}: ImageEditorPreviewV3Props): JSX.Element {
  const { t } = useTranslation('ui')
  const snapshot = useImageEditorBusSnapshotV3(bus)
  const activeTool = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.activeTool ?? 'move',
  )
  const zoom = useImageEditorInteractionStoreV3(
    (state) => state.viewportZoomBySession[controller.sessionId] ?? 1,
  )
  const setViewportZoom = useImageEditorInteractionStoreV3((state) => state.setViewportZoom)

  const managedPreview = useManagedImageEditorPreviewV3(
    controller.sessionId,
    snapshot,
    !previewRenderer,
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
    : managedPreview.resultDocumentId
  const basePreviewRevision = previewRenderer
    ? snapshot.document.revision
    : managedPreview.resultRevision

  return (
    <main
      data-preview-surface
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-bg-dark"
    >
      <div className="absolute inset-0 flex items-center justify-center overflow-auto p-6">
        <div
          className="relative flex max-h-full max-w-full items-center justify-center origin-center"
          style={{ transform: `scale(${zoom})` }}
        >
          {output.kind === 'url' ? (
            <UrlPreview output={output} label={t('imageEditor.v3.previewAlt')} />
          ) : null}
          {output.kind === 'frame' ? (
            <FramePreview output={output} label={t('imageEditor.v3.previewAlt')} />
          ) : null}
          {output.kind === 'content' ? output.content : null}
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
      <div className="ui-glass absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg p-1">
        <UiIconButton
          className="h-8 w-8 text-white hover:text-white"
          showBorder={false}
          appearance="hover-only"
          aria-label={t('imageEditor.v3.zoomOut')}
          title={t('imageEditor.v3.zoomOut')}
          disabled={zoom <= 0.05}
          onClick={() => setViewportZoom(controller.sessionId, zoom / 1.25)}
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
          onClick={() => setViewportZoom(controller.sessionId, zoom * 1.25)}
        >
          <Plus className="h-4 w-4" />
        </UiIconButton>
      </div>
    </main>
  )
}
