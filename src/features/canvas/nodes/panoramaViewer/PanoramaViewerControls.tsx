import { Camera } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Dropdown, UiButton, UiSegmented } from '@/components/ui';
import {
  PANORAMA_VIEWPORT_ASPECT_RATIOS,
  type PanoramaViewMode,
  type PanoramaViewportAspectRatio,
} from '@/features/canvas/domain/panoramaViewer';

interface PanoramaViewerControlsProps {
  viewMode: PanoramaViewMode;
  viewportAspectRatio: PanoramaViewportAspectRatio;
  canCapture: boolean;
  isCapturing: boolean;
  onViewModeChange: (mode: PanoramaViewMode) => void;
  onViewportAspectRatioChange: (ratio: PanoramaViewportAspectRatio) => void;
  onCapture: () => void;
}
export function PanoramaViewerControls({
  viewMode,
  viewportAspectRatio,
  canCapture,
  isCapturing,
  onViewModeChange,
  onViewportAspectRatioChange,
  onCapture,
}: PanoramaViewerControlsProps): JSX.Element {
  const { t } = useTranslation();
  const ratioOptions = useMemo(
    () => PANORAMA_VIEWPORT_ASPECT_RATIOS.map((ratio) => ({ label: ratio, value: ratio })),
    [],
  );
  const captureTitle = canCapture
    ? t('viewer.panorama.captureView')
    : t('viewer.panorama.captureUnavailableFlat');

  return (
    <div
      className="nodrag nopan nowheel relative z-raised flex min-h-12 items-center gap-2 border-t border-line px-2 py-1.5"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {/* 球面 / 平面是模式切换，和全景弹窗、打光手动 / 智能同一种分段控件 */}
      <UiSegmented<PanoramaViewMode>
        ariaLabel={t('viewer.panorama.displayMode')}
        value={viewMode}
        onChange={onViewModeChange}
        options={[
          { value: 'sphere', label: t('viewer.panorama.spherical') },
          { value: 'flat', label: t('viewer.panorama.flat') },
        ]}
      />

      <Dropdown<PanoramaViewportAspectRatio>
        surface="glass"
        value={viewportAspectRatio}
        options={ratioOptions}
        onSelect={onViewportAspectRatioChange}
        ariaLabel={t('viewer.panorama.viewportRatio')}
        appearance="text"
        minWidthStrategy="display"
        className="nodrag nopan nowheel"
        size="md"
      />

      <UiButton
        type="button"
        variant="secondary"
        className="ml-auto"
        disabled={!canCapture || isCapturing}
        tooltip={captureTitle}
        aria-label={captureTitle}
        onClick={onCapture}
      >
        <Camera  />
        {t(isCapturing ? 'viewer.panorama.capturing' : 'viewer.panorama.captureView')}
      </UiButton>
    </div>
  );
}
