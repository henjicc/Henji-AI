import { Camera } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Dropdown, UiButton, UiChipButton } from '@/components/ui';
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
      className="nodrag nopan nowheel relative z-raised flex min-h-12 items-center gap-2 border-t border-veil-subtle px-2 py-1.5"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-1" role="group" aria-label={t('viewer.panorama.displayMode')}>
        <UiChipButton
          selectionRole="navigation"
          active={viewMode === 'sphere'}
          size="md" className="px-2.5"
          onClick={() => onViewModeChange('sphere')}
        >
          {t('viewer.panorama.spherical')}
        </UiChipButton>
        <UiChipButton
          selectionRole="navigation"
          active={viewMode === 'flat'}
          size="md" className="px-2.5"
          onClick={() => onViewModeChange('flat')}
        >
          {t('viewer.panorama.flat')}
        </UiChipButton>
      </div>

      <Dropdown<PanoramaViewportAspectRatio>
        surface="glass"
        value={viewportAspectRatio}
        options={ratioOptions}
        onSelect={onViewportAspectRatioChange}
        ariaLabel={t('viewer.panorama.viewportRatio')}
        appearance="text"
        minWidthStrategy="display"
        className="nodrag nopan nowheel"
        size="md" buttonClassName="px-2.5"
      />

      <UiButton
        type="button"
        variant="secondary"
        className="ml-auto gap-1.5"
        disabled={!canCapture || isCapturing}
        title={captureTitle}
        aria-label={captureTitle}
        onClick={onCapture}
      >
        <Camera className="h-3.5 w-3.5" />
        {t(isCapturing ? 'viewer.panorama.capturing' : 'viewer.panorama.captureView')}
      </UiButton>
    </div>
  );
}
