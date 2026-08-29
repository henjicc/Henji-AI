import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minimize2,
  RotateCcw,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  UiButton,
  UiChipButton,
  UiError,
  UiErrorBoundary,
  UiIconButton,
  UiLoading,
} from '@/components/ui';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DURATION, uiTransition } from '@/components/ui/motion';
import { createLogger } from '@/core/logging';
import { ICON_PANORAMA } from '@/core/theme/icons';
import {
  resolveNodeDownloadTarget,
  saveCanvasMediaTargetAs,
  type CanvasMediaDownloadTarget,
} from '@/features/canvas/application/canvasMediaDownload';
import type { CanvasImageViewerSurfaceProps } from '@/features/canvas/ui/specialInterfaces/viewerSurfaceRegistry';
import { useCanvasStore } from '@/stores/canvasStore';

import { PanoramaSphereCanvas } from './PanoramaSphereCanvas';
import { usePanoramaImageResource } from './usePanoramaImageResource';

const logger = createLogger('features.canvas.panoramaViewer');
const CONTROL_BUTTON_CLASS = '!h-9 !w-9 !rounded-full';

type PanoramaViewMode = 'sphere' | 'flat';

function createFallbackDownloadTarget(
  imageUrl: string,
  sourceNodeId?: string | null,
): CanvasMediaDownloadTarget {
  return {
    nodeId: sourceNodeId ?? 'panorama-viewer',
    mediaType: 'image',
    source: imageUrl,
    suggestedFileName: '720-panorama.png',
    panorama: true,
  };
}

export function PanoramaViewerModal({
  open,
  imageUrl,
  imageList,
  currentIndex,
  onClose,
  onNavigate,
  sourceNodeId,
}: CanvasImageViewerSurfaceProps): JSX.Element | null {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0);
  const [viewMode, setViewMode] = useState<PanoramaViewMode>('sphere');
  const [resetRevision, setResetRevision] = useState(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const sourceNode = useCanvasStore((state) => (
    sourceNodeId ? state.nodes.find((node) => node.id === sourceNodeId) : undefined
  ));
  const resource = usePanoramaImageResource(
    imageUrl,
    open && isVisible,
    retryRevision,
    sourceNodeId,
  );
  const downloadTarget = useMemo(
    () => (sourceNode ? resolveNodeDownloadTarget(sourceNode) : null)
      ?? createFallbackDownloadTarget(imageUrl, sourceNodeId),
    [imageUrl, sourceNode, sourceNodeId],
  );

  useEffect(() => {
    if (open) {
      if (isVisible) return;
      setIsVisible(true);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
      setOverlayOpacity(0);
      requestAnimationFrame(() => setOverlayOpacity(1));
      logger.info('全景查看器打开', {
        event: 'panorama.viewer.open.completed',
        sourceNodeId: sourceNodeId ?? null,
      });
      return;
    }
    if (!isVisible) return;
    setOverlayOpacity(0);
    closeTimerRef.current = window.setTimeout(() => {
      setIsVisible(false);
      closeTimerRef.current = null;
    }, UI_DURATION.viewer);
    logger.info('全景查看器关闭', {
      event: 'panorama.viewer.close.completed',
      sourceNodeId: sourceNodeId ?? null,
    });
  }, [isVisible, open, sourceNodeId]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isVisible]);

  useEffect(() => {
    setViewMode('sphere');
    setResetRevision((revision) => revision + 1);
    setDownloadFailed(false);
  }, [imageUrl]);

  useEffect(() => {
    const handleFullscreenChange = (): void => {
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (open || document.fullscreenElement !== rootRef.current) return;
    void document.exitFullscreen().catch(() => undefined);
  }, [open]);

  const handleFullscreen = useCallback(async (): Promise<void> => {
    try {
      if (document.fullscreenElement === rootRef.current) {
        await document.exitFullscreen();
      } else {
        await rootRef.current?.requestFullscreen();
      }
    } catch (error) {
      logger.error('全景查看器全屏切换失败', error, {
        event: 'panorama.viewer.fullscreen.failed',
        context: { sourceNodeId: sourceNodeId ?? null },
      });
    }
  }, [sourceNodeId]);

  const handleDownload = useCallback(async (): Promise<void> => {
    if (isDownloading) return;
    setIsDownloading(true);
    setDownloadFailed(false);
    try {
      await saveCanvasMediaTargetAs(downloadTarget);
    } catch {
      setDownloadFailed(true);
    } finally {
      setIsDownloading(false);
    }
  }, [downloadTarget, isDownloading]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && document.fullscreenElement !== rootRef.current) onClose();
      if (event.key === 'ArrowLeft') onNavigate('prev');
      if (event.key === 'ArrowRight') onNavigate('next');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onNavigate, open]);

  if (!isVisible) return null;

  const isReady = resource.status === 'ready';
  const isSphereAvailable = isReady && resource.isEquirectangular;
  const renderSphere = viewMode === 'sphere' && isSphereAvailable && open;
  const showFlat = viewMode === 'flat' || (isReady && !resource.isEquirectangular);
  const dimensions = isReady ? `${resource.width} × ${resource.height}` : '';

  return (
    <div
      ref={rootRef}
      data-panorama-viewer="true"
      data-panorama-view-mode={renderSphere ? 'sphere' : 'flat'}
      className={/* ui-surface-allow: 全屏沉浸式媒体查看器，铺满视口，不是 UiModal 的居中卡片语义 */ `fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-viewer overflow-hidden bg-bg-dark`}
      style={{
        opacity: overlayOpacity,
        transition: uiTransition(['opacity'], UI_DURATION.viewer),
        pointerEvents: open ? 'auto' : 'none',
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('viewer.panorama.title')}
    >
      <div className="absolute inset-0 pt-12">
        {renderSphere && resource.status === 'ready' ? (
          <UiErrorBoundary
            loggerDomain="features.canvas.panoramaViewer"
            event="panorama.viewer.webgl.failed"
            title={t('viewer.panorama.webglError')}
          >
            <PanoramaSphereCanvas
              image={resource.image}
              resetRevision={resetRevision}
              interactionLabel={t('viewer.panorama.directInteractionLabel')}
            />
          </UiErrorBoundary>
        ) : null}

        {showFlat ? (
          <div className="flex h-full w-full items-center justify-center overflow-hidden p-4" data-panorama-surface="flat">
            <img
              src={resource.displayUrl}
              alt={t('viewer.panorama.flatAlt')}
              className="max-h-full max-w-full select-none object-contain"
              draggable={false}
            />
          </div>
        ) : null}

        {viewMode === 'sphere' && resource.status === 'loading' ? (
          <UiLoading message={t('viewer.panorama.loading')} className="h-full text-text-muted" />
        ) : null}

        {viewMode === 'sphere' && resource.status === 'error' ? (
          <UiError
            title={t('viewer.panorama.loadErrorTitle')}
            message={t('viewer.panorama.loadErrorMessage')}
            className="h-full"
            onRetry={() => setRetryRevision((revision) => revision + 1)}
            retryLabel={t('viewer.panorama.retry')}
            actions={(
              <>
                <UiButton variant="ghost" size="sm" onClick={() => setViewMode('flat')}>
                  {t('viewer.panorama.flat')}
                </UiButton>
                <UiButton variant="ghost" size="sm" onClick={() => void handleDownload()}>
                  {t('viewer.panorama.download')}
                </UiButton>
              </>
            )}
          />
        ) : null}
      </div>

      <header className="ui-glass absolute inset-x-0 top-0 z-sticky flex h-12 items-center gap-3 border-b border-veil-subtle px-3">
        <div className="flex min-w-0 items-center gap-2 text-white">
          <ICON_PANORAMA className="h-4 w-4 shrink-0" />
          <span className="truncate text-sm font-medium">{t('viewer.panorama.title')}</span>
          {dimensions ? <span className="hidden text-xs text-white/70 sm:inline">{dimensions}</span> : null}
        </div>

        {imageList.length > 1 ? (
          <div className="flex items-center gap-1">
            <UiIconButton
              appearance="glass"
              className={CONTROL_BUTTON_CLASS}
              onClick={() => onNavigate('prev')}
              disabled={currentIndex <= 0}
              title={t('viewer.prev')}
            >
              <ChevronLeft className="h-4 w-4" />
            </UiIconButton>
            <span className="min-w-[44px] text-center text-xs text-white/70">
              {currentIndex + 1} / {imageList.length}
            </span>
            <UiIconButton
              appearance="glass"
              className={CONTROL_BUTTON_CLASS}
              onClick={() => onNavigate('next')}
              disabled={currentIndex >= imageList.length - 1}
              title={t('viewer.next')}
            >
              <ChevronRight className="h-4 w-4" />
            </UiIconButton>
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <UiChipButton
            selectionRole="navigation"
            active={viewMode === 'sphere' && isSphereAvailable}
            disabled={isReady && !resource.isEquirectangular}
            className="h-8 px-3 text-xs text-white"
            onClick={() => setViewMode('sphere')}
          >
            {t('viewer.panorama.spherical')}
          </UiChipButton>
          <UiChipButton
            selectionRole="navigation"
            active={showFlat}
            className="h-8 px-3 text-xs text-white"
            onClick={() => setViewMode('flat')}
          >
            {t('viewer.panorama.flat')}
          </UiChipButton>
          <UiIconButton
            appearance="glass"
            className={CONTROL_BUTTON_CLASS}
            onClick={() => setResetRevision((revision) => revision + 1)}
            disabled={!renderSphere}
            title={t('viewer.reset')}
          >
            <RotateCcw className="h-4 w-4" />
          </UiIconButton>
          <UiIconButton
            appearance="glass"
            className={CONTROL_BUTTON_CLASS}
            onClick={() => void handleDownload()}
            disabled={isDownloading}
            title={t('viewer.panorama.download')}
          >
            <Download className="h-4 w-4" />
          </UiIconButton>
          <UiIconButton
            appearance="glass"
            className={CONTROL_BUTTON_CLASS}
            onClick={() => void handleFullscreen()}
            title={t(isFullscreen ? 'viewer.panorama.exitFullscreen' : 'viewer.panorama.fullscreen')}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </UiIconButton>
          <UiIconButton
            appearance="glass"
            className={CONTROL_BUTTON_CLASS}
            onClick={onClose}
            title={t('common.close')}
          >
            <X className="h-4 w-4" />
          </UiIconButton>
        </div>
      </header>

      {isReady && !resource.isEquirectangular ? (
        <div className="ui-glass pointer-events-none absolute left-1/2 top-16 z-sticky -translate-x-1/2 rounded-full px-4 py-2 text-xs text-white">
          {t('viewer.panorama.invalidRatio', { dimensions })}
        </div>
      ) : null}

      {renderSphere ? (
        <div className="ui-glass pointer-events-none absolute bottom-5 left-1/2 z-sticky -translate-x-1/2 rounded-full px-4 py-2 text-xs text-white/80">
          {t('viewer.panorama.interactionHint')}
        </div>
      ) : null}

      {downloadFailed ? (
        <div className="ui-glass pointer-events-none absolute bottom-5 right-5 z-sticky rounded-full px-4 py-2 text-xs text-danger">
          {t('viewer.panorama.downloadFailed')}
        </div>
      ) : null}
    </div>
  );
}
