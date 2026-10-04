import { AlertCircle, LoaderCircle } from 'lucide-react';
import { UiEmpty } from '@/components/ui';
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
    <div className="relative h-full w-full overflow-hidden rounded-[var(--node-radius)] bg-gap">
      {imageSource ? (
        <CanvasNodeImage
          src={imageSource}
          viewerSourceUrl={imageViewerSource}
          alt={t('node.cameraStage.previewAlt')}
          className="h-full w-full object-contain"
          disableViewer
        />
      ) : (
        <UiEmpty size="node" icon={<ICON_TOOL_CAMERA_STAGE className="h-7 w-7" />} title={t('node.cameraStage.empty')} />
      )}

      {rendering && (
        <>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gap/65">
            <div className="ui-glass flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-text1">
              <LoaderCircle className="h-4 w-4 animate-spin text-accent-text" />
              {t(progressKey, { progress: Math.round((renderProgress ?? 0) * 100) })}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 bg-hover">
            <div className="h-full origin-left bg-accent transition-transform duration-120" style={{ transform: `scaleX(${renderProgress ?? 0})` }} />
          </div>
        </>
      )}

      {!rendering && renderError && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gap/70"
          title={renderError}
        >
          <div className="ui-glass flex max-w-[80%] items-center gap-2 rounded-lg px-3 py-2 text-xs text-text1">
            <AlertCircle className="h-4 w-4 shrink-0 text-danger-text" />
            <span className="truncate">{t('node.cameraStage.renderFailed')}</span>
          </div>
        </div>
      )}

      {/* 悬停提示压在三维预览画面上：固定媒体叠层（深色底 + 白字），不随主题 */}
      <span className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center opacity-0 transition-opacity group-hover:opacity-100">
        <span className="rounded-full bg-media-control px-2 py-0.5 text-2xs text-on-media">
          {t(rendering ? 'node.cameraStage.openBlockedRendering' : 'node.cameraStage.openHint')}
        </span>
      </span>
    </div>
  );
}
