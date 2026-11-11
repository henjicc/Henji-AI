import { UiButton, UiSpinner } from '@/components/ui'
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { AlertCircle } from 'lucide-react';
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
  onOpen: () => void;
}

export function CameraStagePreviewPanel({
  imageSource,
  imageViewerSource,
  rendering,
  renderProgress,
  renderPhase,
  renderError,
  onOpen,
}: CameraStagePreviewPanelProps): JSX.Element {
  const { t } = useTranslation();
  const progressKey = renderPhase === 'preparing'
    ? 'node.cameraStage.preparing'
    : renderPhase === 'encoding'
      ? 'node.cameraStage.encoding'
      : 'node.cameraStage.rendering';

  // 画面贴住节点顶边，底边直接接节点里的行，卡片里不另圈一块
  return (
    <div className="relative h-full w-full overflow-hidden rounded-t-[var(--node-radius)] bg-gap">
      {imageSource ? (
        <CanvasNodeImage
          src={imageSource}
          viewerSourceUrl={imageViewerSource}
          alt={t('node.cameraStage.previewAlt')}
          className="h-full w-full object-contain"
          disableViewer
        />
      ) : (
        <UiEmpty size="node" icon={<ICON_TOOL_CAMERA_STAGE className={`${UI_ICON_SIZE_CLASS.xl}`} />} title={t('node.cameraStage.empty')} />
      )}

      {rendering && (
        <>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gap/65">
            <div className="ui-glass flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-text1">
              <UiSpinner size="sm" tone="accent" />
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
            <AlertCircle className={`${UI_ICON_SIZE_CLASS.md} shrink-0 text-danger-text`} />
            <span className="truncate">{t('node.cameraStage.renderFailed')}</span>
          </div>
        </div>
      )}

      {/* 悬停时画面中央的打开入口，与双击同一件事；渲染中打不开 */}
      {!rendering ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-120 group-hover:opacity-100 focus-within:opacity-100">
          <UiButton
            variant="media"
            size="sm"
            className="nodrag pointer-events-auto"
            tooltip={t('node.cameraStage.openHint')}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={onOpen}
          >
            <ICON_TOOL_CAMERA_STAGE />
            {t('node.cameraStage.openShort')}
          </UiButton>
        </div>
      ) : null}
    </div>
  );
}
