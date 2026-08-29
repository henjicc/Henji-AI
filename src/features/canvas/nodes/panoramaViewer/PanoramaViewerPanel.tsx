import { useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { UiEmpty, UiError, UiErrorBoundary, UiLoading } from '@/components/ui';
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
  hasWebglFailure: boolean;
  captureRef: MutableRefObject<PanoramaCaptureCurrentView | null>;
  onRetry: () => void;
  onRequestSphere: () => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  onOpenImmersiveViewer: () => void;
  onViewModeChange: (mode: PanoramaViewMode) => void;
  onViewportAspectRatioChange: (ratio: PanoramaViewportAspectRatio) => void;
  onCameraViewChangeEnd: (view: PanoramaCameraView) => void;
  onSphereFramePresented: () => void;
  onCapture: () => void;
  onFrozenPreviewReady: () => void;
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
  hasWebglFailure,
  captureRef,
  onRetry,
  onRequestSphere,
  onInteractionStart,
  onInteractionEnd,
  onOpenImmersiveViewer,
  onViewModeChange,
  onViewportAspectRatioChange,
  onCameraViewChangeEnd,
  onSphereFramePresented,
  onCapture,
  onFrozenPreviewReady,
  onContextLost,
}: PanoramaViewerPanelProps): JSX.Element {
  const { t } = useTranslation();
  const [resetRevision] = useState(0);
  const [loadedFrozenPreviewUrl, setLoadedFrozenPreviewUrl] = useState<string | null>(null);
  const [readyFrozenPreviewUrl, setReadyFrozenPreviewUrl] = useState<string | null>(null);
  const isReady = resource.status === 'ready';
  const isSphereAvailable = isReady && resource.isEquirectangular;
  const showStaticResource = viewMode === 'flat'
    || (viewMode === 'sphere' && !renderSphere && !frozenPreviewUrl);
  const showFrozenPreview = viewMode === 'sphere' && Boolean(frozenPreviewUrl);
  const isSphereFramePresented = renderSphere
    && Boolean(frozenPreviewUrl)
    && readyFrozenPreviewUrl === frozenPreviewUrl;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--node-radius)] bg-bg-dark">
      <div
        className="nodrag nopan nowheel relative min-h-0 flex-1 overflow-hidden touch-none"
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
          if (viewMode === 'sphere' && isSphereAvailable && !hasWebglFailure) {
            if (!renderSphere) setReadyFrozenPreviewUrl(null);
            onRequestSphere();
          }
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (viewMode === 'sphere' && isSphereAvailable && !hasWebglFailure) onRequestSphere();
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
                onInteractionEnd={onInteractionEnd}
                onViewChangeEnd={onCameraViewChangeEnd}
                onFramePresented={() => {
                  setReadyFrozenPreviewUrl(frozenPreviewUrl);
                  onSphereFramePresented();
                }}
                onContextLost={onContextLost}
              />
            </UiErrorBoundary>
          </div>
        ) : null}

        {showStaticResource && resource.displayUrl ? (
          <img
            src={resource.displayUrl}
            alt={t('viewer.panorama.flatAlt')}
            className="h-full w-full select-none object-contain"
            draggable={false}
          />
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
            className={`pointer-events-none absolute inset-0 h-full w-full select-none object-contain ${
              isSphereFramePresented
                ? 'opacity-0 transition-opacity duration-150'
                : 'opacity-100'
            }`}
            draggable={false}
            onLoad={() => {
              setLoadedFrozenPreviewUrl(frozenPreviewUrl);
              onFrozenPreviewReady();
            }}
          />
        ) : null}

        {viewMode === 'sphere' && resource.status === 'loading' ? (
          <UiLoading message={t('viewer.panorama.loading')} className="h-full text-text-muted" />
        ) : null}

        {resource.status === 'idle' && !isGenerating && !generationError ? (
          <UiEmpty
            size="sm"
            title={t('viewer.panorama.emptyTitle')}
            description={t('viewer.panorama.emptyDescription')}
            className="h-full px-6 text-text-muted"
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
          <UiLoading message={t('viewer.panorama.generating')} className="h-full text-text-muted" />
        ) : null}

        {isReady && !resource.isEquirectangular ? (
          <div className="ui-glass pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-2xs text-text-primary">
            {t('viewer.panorama.invalidRatio', {
              dimensions: `${resource.width} × ${resource.height}`,
            })}
          </div>
        ) : null}

        {viewMode === 'sphere' && isSphereAvailable && !renderSphere && !frozenPreviewUrl ? (
          <div className="ui-glass pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-2xs text-text-secondary">
            {t(hasWebglFailure ? 'viewer.panorama.webglError' : 'viewer.panorama.directInteractionHint')}
          </div>
        ) : null}

        {isGenerating ? <div className="pointer-events-none absolute inset-0 bg-bg-dark/55" /> : null}
        {generationError ? <NodeGenerationError message={generationError} /> : null}
      </div>

      <PanoramaViewerControls
        viewMode={viewMode}
        viewportAspectRatio={viewportAspectRatio}
        canCapture={isSphereAvailable && !hasWebglFailure && !isGenerating && !generationError}
        isCapturing={isCapturing}
        onViewModeChange={onViewModeChange}
        onViewportAspectRatioChange={onViewportAspectRatioChange}
        onCapture={onCapture}
      />
    </div>
  );
}
