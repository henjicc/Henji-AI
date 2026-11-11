import { Camera } from 'lucide-react';
import { useMemo, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Dropdown, UiIconButton, UiSegmented } from '@/components/ui';
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
  /** 选中节点时常显；否则只在悬停或键盘聚焦时出现，平时画面上什么都不压。 */
  pinned: boolean;
  onViewModeChange: (mode: PanoramaViewMode) => void;
  onViewportAspectRatioChange: (ratio: PanoramaViewportAspectRatio) => void;
  onCapture: () => void;
}

/** 叠在画面底边的两组控件：左下显示方式与视口比例，右下截取视角。 */
export function PanoramaViewerControls({
  viewMode,
  viewportAspectRatio,
  canCapture,
  isCapturing,
  pinned,
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
    ? t(isCapturing ? 'viewer.panorama.capturing' : 'viewer.panorama.captureView')
    : t('viewer.panorama.captureUnavailableFlat');
  const reveal = `transition-opacity duration-120 ${pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`;
  const stopCanvasGesture = {
    onPointerDown: (event: PointerEvent) => event.stopPropagation(),
    onDoubleClick: (event: MouseEvent) => event.stopPropagation(),
    onWheel: (event: WheelEvent) => event.stopPropagation(),
  };

  return (
    <>
      <div
        className={`ui-glass nodrag nopan nowheel absolute bottom-2 left-2 z-raised flex items-center gap-0.5 rounded-lg p-0.5 ${reveal}`}
        {...stopCanvasGesture}
      >
        <UiSegmented<PanoramaViewMode>
          ariaLabel={t('viewer.panorama.displayMode')}
          value={viewMode}
          onChange={onViewModeChange}
          size="sm"
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
          size="sm"
        />
      </div>
      <div className={`nodrag nopan nowheel absolute bottom-2 right-2 z-raised ${reveal}`} {...stopCanvasGesture}>
        <UiIconButton
          tone="media"
          size="sm"
          disabled={!canCapture || isCapturing}
          tooltip={captureTitle}
          aria-label={captureTitle}
          onClick={onCapture}
        >
          <Camera />
        </UiIconButton>
      </div>
    </>
  );
}
