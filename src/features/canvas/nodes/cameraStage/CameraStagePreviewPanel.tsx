import { AlertCircle, Clapperboard, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';

interface CameraStagePreviewPanelProps {
  imageSource: string | null;
  imageViewerSource: string | null;
  videoExporting: boolean;
  videoProgress: number | null;
  videoRenderPhase: 'preparing' | 'rendering' | 'encoding' | null;
  videoRenderError: string | null;
}

export function CameraStagePreviewPanel({
  imageSource,
  imageViewerSource,
  videoExporting,
  videoProgress,
  videoRenderPhase,
  videoRenderError,
}: CameraStagePreviewPanelProps): JSX.Element {
  const { t } = useTranslation();
  const progressKey = videoRenderPhase === 'preparing'
    ? 'node.cameraStage.preparing'
    : videoRenderPhase === 'encoding'
      ? 'node.cameraStage.encoding'
      : 'node.cameraStage.rendering';

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[var(--node-radius)] bg-bg-dark">
      {imageSource ? (
        <CanvasNodeImage
          src={imageSource}
          viewerSourceUrl={imageViewerSource}
          alt={t('node.cameraStage.previewAlt')}
          className="h-full w-full object-contain"
          disableViewer
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-text-muted/85">
          <Clapperboard className="h-7 w-7 opacity-60" />
          <span className="px-4 text-center text-[12px] leading-6">{t('node.cameraStage.empty')}</span>
        </div>
      )}

      {videoExporting && (
        <>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg-dark/65">
            <div className="flex items-center gap-2 rounded-lg bg-surface-dark/90 px-3 py-2 text-xs text-text-dark">
              <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
              {t(progressKey, { progress: Math.round((videoProgress ?? 0) * 100) })}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 bg-layer">
            <div className="h-full origin-left bg-accent transition-transform duration-150" style={{ transform: `scaleX(${videoProgress ?? 0})` }} />
          </div>
        </>
      )}

      {!videoExporting && videoRenderError && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg-dark/70"
          title={videoRenderError}
        >
          <div className="flex max-w-[80%] items-center gap-2 rounded-lg bg-surface-dark/90 px-3 py-2 text-xs text-text-dark">
            <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
            <span className="truncate">{t('node.cameraStage.renderFailed')}</span>
          </div>
        </div>
      )}

      <span className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-3xs text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
        {t(videoExporting ? 'node.cameraStage.openBlockedRendering' : 'node.cameraStage.openHint')}
      </span>
    </div>
  );
}
