import { AlertCircle, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { ICON_TOOL_CAMERA_STAGE } from '@/core/theme/icons'

interface CameraStagePreviewPanelProps {
  imageSource: string | null;
  imageViewerSource: string | null;
  rendering: boolean;
  renderProgress: number | null;
  renderPhase: 'preparing' | 'rendering' | 'encoding' | null;
  renderError: string | null;
}

export function CameraStagePreviewPanel({
  imageSource,
  imageViewerSource,
  rendering,
  renderProgress,
  renderPhase,
  renderError,
}: CameraStagePreviewPanelProps): JSX.Element {
  const { t } = useTranslation();
  const progressKey = renderPhase === 'preparing'
    ? 'node.cameraStage.preparing'
    : renderPhase === 'encoding'
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
          <ICON_TOOL_CAMERA_STAGE className="h-7 w-7 opacity-60" />
          <span className="px-4 text-center text-xs leading-6">{t('node.cameraStage.empty')}</span>
        </div>
      )}

      {rendering && (
        <>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg-dark/65">
            <div className="flex items-center gap-2 rounded-lg bg-surface-dark/90 px-3 py-2 text-xs text-text-dark">
              <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
              {t(progressKey, { progress: Math.round((renderProgress ?? 0) * 100) })}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 bg-layer">
            <div className="h-full origin-left bg-accent transition-transform duration-150" style={{ transform: `scaleX(${renderProgress ?? 0})` }} />
          </div>
        </>
      )}

      {!rendering && renderError && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg-dark/70"
          title={renderError}
        >
          <div className="flex max-w-[80%] items-center gap-2 rounded-lg bg-surface-dark/90 px-3 py-2 text-xs text-text-dark">
            <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
            <span className="truncate">{t('node.cameraStage.renderFailed')}</span>
          </div>
        </div>
      )}

      <span className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-3xs text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
        {t(rendering ? 'node.cameraStage.openBlockedRendering' : 'node.cameraStage.openHint')}
      </span>
    </div>
  );
}
