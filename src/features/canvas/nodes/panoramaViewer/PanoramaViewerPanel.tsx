import { useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiEmpty, UiError, UiErrorBoundary, UiLoading } from '@/components/ui';
import { viewportTransform, type ViewportPan } from '@/core/viewport/zoomPan';
import { useZoomPanViewport } from '@/hooks/useZoomPanViewport';
import type {
  PanoramaCameraView,
  PanoramaViewMode,
  PanoramaViewportAspectRatio,
} from '@/features/canvas/domain/panoramaViewer';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { PanoramaSphereCanvas, type PanoramaCaptureCurrentView } from '@/features/canvas/ui/specialInterfaces/panorama/PanoramaSphereCanvas';
import type { PanoramaImageResource } from '@/features/canvas/ui/specialInterfaces/panorama/usePanoramaImageResource';
import { NodeGenerationError } from '@/features/canvas/nodes/shared/NodeGenerationError';

import { PanoramaViewerControls } from './PanoramaViewerControls';

interface PanoramaViewerPanelProps {
  resource: PanoramaImageResource;
  viewMode: PanoramaViewMode;
  viewportAspectRatio: PanoramaViewportAspectRatio;
  cameraView: PanoramaCameraView;
  currentViewRef: MutableRefObject<PanoramaCameraView | null>;
  frozenPreviewUrl: string | null;
  renderSphere: boolean;
  isGenerating: boolean;
  generationError: string | null;
  isCapturing: boolean;
  /** 节点选中时控件常显。 */
  controlsPinned: boolean;
  hasWebglFailure: boolean;
  captureRef: MutableRefObject<PanoramaCaptureCurrentView | null>;
  onRetry: () => void;
  onRequestSphere: () => void;
  onInteractionStart: () => void;
  onOpenImmersiveViewer: () => void;
  onViewModeChange: (mode: PanoramaViewMode) => void;
  onViewportAspectRatioChange: (ratio: PanoramaViewportAspectRatio) => void;
  onCameraViewChangeEnd: (view: PanoramaCameraView) => void;
  onSphereFramePresented: () => void;
  onCapture: () => void;
  onContextLost: () => void;
}

export function PanoramaViewerPanel({
  resource,
  viewMode,
  viewportAspectRatio,
  cameraView,
  currentViewRef,
  frozenPreviewUrl,
  renderSphere,
  isGenerating,
  generationError,
  isCapturing,
  controlsPinned,
  hasWebglFailure,
  captureRef,
  onRetry,
  onRequestSphere,
  onInteractionStart,
  onOpenImmersiveViewer,
  onViewModeChange,
  onViewportAspectRatioChange,
  onCameraViewChangeEnd,
  onSphereFramePresented,
  onCapture,
  onContextLost,
}: PanoramaViewerPanelProps): JSX.Element {
  const { t } = useTranslation();
  const [resetRevision] = useState(0);
  const [loadedFrozenPreviewUrl, setLoadedFrozenPreviewUrl] = useState<string | null>(null);
  // 实时球面画出首帧后冻结图就一直隐藏；之后实时画面里重截的冻结图只备着，不再盖回画面上
  const [spherePresented, setSpherePresented] = useState(false);
  if (!renderSphere && spherePresented) setSpherePresented(false);
  const isReady = resource.status === 'ready';
  const isSphereAvailable = isReady && resource.isEquirectangular;
  const canRequestSphere = resource.status === 'loading' || isSphereAvailable;
  const showStaticResource = viewMode === 'flat'
    || (viewMode === 'sphere' && !renderSphere && !frozenPreviewUrl);
  const showFrozenPreview = viewMode === 'sphere' && Boolean(frozenPreviewUrl);
  const isSphereFramePresented = renderSphere && spherePresented;
  // 冻结帧要与实时球面逐像素重合：画布按 offsetWidth/offsetHeight（整数布局尺寸）定尺寸，冻结帧取自同一
  // 绘制缓冲。面板在缩放后的画布视口里布局尺寸常带小数，若冻结图铺满面板（inset-0）就比画布小零点几像素，
  // 切换时画面整体错动约 1px（4.1）。冻结图因此按同一整数尺寸摆放（max-w-none：预检样式的 img max-width:100%
  // 会把宽度压回面板宽）。
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [surfaceSize, setSurfaceSize] = useState<{ width: number; height: number } | null>(null);
  // 冻结图取自绘制缓冲（布局尺寸 × 像素比取整），与面板比例只差取整误差时按画布同样的方式拉伸铺满（object-fill），
  // 才与实时画面逐像素重合；节点改过比例、冻结图还没重拍时比例差得多，退回 object-contain 不变形。
  const [frozenNaturalSize, setFrozenNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const frozenMatchesSurface = Boolean(surfaceSize && frozenNaturalSize && frozenNaturalSize.height > 0
    && Math.abs((frozenNaturalSize.width / frozenNaturalSize.height) / (surfaceSize.width / surfaceSize.height) - 1) < 0.01);
  useLayoutEffect(() => {
    const element = surfaceRef.current;
    if (!element) return undefined;
    const measure = (): void => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      setSurfaceSize((current) => {
        if (width <= 0 || height <= 0) return null;
        return current?.width === width && current.height === height ? current : { width, height };
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-[var(--node-radius)] bg-gap">
      <div
        ref={surfaceRef}
        className="nodrag nopan nowheel absolute inset-0 overflow-hidden touch-none"
        role="region"
        aria-label={t('viewer.panorama.directInteractionLabel')}
        data-panorama-inline-surface={renderSphere ? 'sphere' : 'flat'}
        onPointerEnter={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left
            || event.clientX > bounds.right
            || event.clientY < bounds.top
            || event.clientY > bounds.bottom
          ) return;
          if (viewMode === 'sphere' && canRequestSphere && !hasWebglFailure) {
            onRequestSphere();
          }
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (viewMode === 'sphere' && canRequestSphere && !hasWebglFailure) onRequestSphere();
        }}
        onWheel={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (isReady) onOpenImmersiveViewer();
        }}
      >
        {renderSphere && resource.status === 'ready' ? (
          <div className="absolute inset-0">
            <UiErrorBoundary
              loggerDomain="features.canvas.panoramaViewerNode"
              event="panorama.node.webgl.failed"
              title={t('viewer.panorama.webglError')}
            >
              <PanoramaSphereCanvas
                image={resource.image}
                resetRevision={resetRevision}
                interactionLabel={t('viewer.panorama.directInteractionLabel')}
                initialView={cameraView}
                currentViewRef={currentViewRef}
                captureRef={captureRef}
                onInteractionStart={onInteractionStart}
                onViewChangeEnd={onCameraViewChangeEnd}
                onFramePresented={() => {
                  setSpherePresented(true);
                  onSphereFramePresented();
                }}
                onContextLost={onContextLost}
              />
            </UiErrorBoundary>
          </div>
        ) : null}

        {showStaticResource && resource.displayUrl ? (
          <PanoramaFlatImage src={resource.displayUrl} alt={t('viewer.panorama.flatAlt')} hint={t('ui:viewportZoom.hint')} />
        ) : null}

        {showFrozenPreview && frozenPreviewUrl ? (
          <img
            src={resolveImageDisplayUrl(frozenPreviewUrl)}
            alt={renderSphere ? '' : t('viewer.panorama.flatAlt')}
            aria-hidden={renderSphere ? true : undefined}
            data-panorama-frozen-preview={
              loadedFrozenPreviewUrl === frozenPreviewUrl ? 'true' : undefined
            }
            data-panorama-transition-preview={
              renderSphere && !isSphereFramePresented ? 'true' : undefined
            }
            style={surfaceSize ? { width: surfaceSize.width, height: surfaceSize.height } : undefined}
            className={`pointer-events-none absolute left-0 top-0 h-full w-full max-w-none select-none ${
              frozenMatchesSurface ? 'object-fill' : 'object-contain'
            } ${
              isSphereFramePresented
                ? 'opacity-0 transition-opacity duration-120'
                : 'opacity-100'
            }`}
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              setFrozenNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
              setLoadedFrozenPreviewUrl(frozenPreviewUrl);
            }}
          />
        ) : null}

        {viewMode === 'sphere' && resource.status === 'loading' ? (
          <UiLoading message={t('viewer.panorama.loading')} className="h-full" />
        ) : null}

        {resource.status === 'idle' && !isGenerating && !generationError ? (
          <UiEmpty
            size="sm"
            title={t('viewer.panorama.emptyTitle')}
            description={t('viewer.panorama.emptyDescription')}
            className="h-full px-6"
          />
        ) : null}

        {resource.status === 'error' ? (
          <UiError
            title={t('viewer.panorama.loadErrorTitle')}
            message={t('viewer.panorama.loadErrorMessage')}
            className="h-full"
            onRetry={onRetry}
            retryLabel={t('viewer.panorama.retry')}
          />
        ) : null}

        {isGenerating && !resource.displayUrl ? (
          <UiLoading message={t('viewer.panorama.generating')} className="h-full" />
        ) : null}

        {isReady && !resource.isEquirectangular ? (
          <div className="ui-glass pointer-events-none absolute left-1/2 top-2 max-w-[90%] -translate-x-1/2 truncate rounded-full px-3 py-1 text-2xs text-text1">
            {t('viewer.panorama.invalidRatio', {
              dimensions: `${resource.width} × ${resource.height}`,
            })}
          </div>
        ) : null}

        {viewMode === 'sphere' && hasWebglFailure ? (
          <div className="ui-glass pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-2xs text-text2">
            {t('viewer.panorama.webglError')}
          </div>
        ) : null}

        {isGenerating ? <div className="pointer-events-none absolute inset-0 bg-gap/55" /> : null}
        {generationError ? <NodeGenerationError message={generationError} /> : null}
      </div>

      <PanoramaViewerControls
        viewMode={viewMode}
        viewportAspectRatio={viewportAspectRatio}
        canCapture={isSphereAvailable && !hasWebglFailure && !isGenerating && !generationError}
        isCapturing={isCapturing}
        pinned={controlsPinned}
        onViewModeChange={onViewModeChange}
        onViewportAspectRatioChange={onViewportAspectRatioChange}
        onCapture={onCapture}
      />
    </div>
  );
}

const FLAT_ZOOM_LIMITS = { min: 1, max: 8 };

/** 平面查看全景原图：滚轮缩放、空格或中键拖动平移；放大后左上角出现读数，点它回到适合（球面模式的缩放是改视野，在三维画布里）。 */
function PanoramaFlatImage({ src, alt, hint }: { src: string; alt: string; hint: string }): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  // 平面图是整张放进框里（object-contain），放大后边缘不拖进框里
  const clampPan = (pan: ViewportPan, zoom: number): ViewportPan => {
    const frame = frameRef.current;
    const maxX = frame ? (frame.offsetWidth * (zoom - 1)) / 2 : 0;
    const maxY = frame ? (frame.offsetHeight * (zoom - 1)) / 2 : 0;
    return { x: Math.min(maxX, Math.max(-maxX, pan.x)), y: Math.min(maxY, Math.max(-maxY, pan.y)) };
  };
  const view = useZoomPanViewport(frameRef, { limits: FLAT_ZOOM_LIMITS, clampPan, resetKey: src });
  return (
    <div ref={frameRef} className={`absolute inset-0 overflow-hidden ${view.panning ? 'cursor-grabbing' : view.panReady ? 'cursor-grab' : ''}`}>
      <img
        src={src}
        alt={alt}
        className="h-full w-full select-none object-contain"
        style={{ transform: viewportTransform(view.zoom, view.pan, FLAT_ZOOM_LIMITS) }}
        draggable={false}
      />
      {view.zoom !== 1 ? (
        <UiButton variant="media" size="sm" className="absolute left-2 top-2 tabular-nums" tooltip={hint} onClick={view.reset}>
          {`${Math.round(view.zoom * 100)}%`}
        </UiButton>
      ) : null}
    </div>
  );
}
