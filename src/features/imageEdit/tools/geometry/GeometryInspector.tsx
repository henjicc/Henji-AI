import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, X } from 'lucide-react';
import { UiChipButton } from '@/components/ui';
import { CROP_RATIO_OPTIONS } from '@/features/imageMark/editor/shared';
import type { OrientationOp } from '@/features/imageMark/domain/geometry';
import { useMarkEditorContext } from '@/features/imageMark/editor/useMarkEditorContext';

const ICON_CLASS = 'h-4 w-4';
const CHIP_CLASS = '!h-9 !gap-1.5 !px-2.5 !text-xs';

const ORIENTATION_BUTTONS: { operation: OrientationOp; label: string; icon: typeof RotateCw }[] = [
  { operation: 'rotate-ccw', label: '左转', icon: RotateCcw },
  { operation: 'rotate-cw', label: '右转', icon: RotateCw },
  { operation: 'flip-h', label: '水平翻转', icon: FlipHorizontal2 },
  { operation: 'flip-v', label: '垂直翻转', icon: FlipVertical2 },
];

export function GeometryInspector(): JSX.Element {
  const {
    tool,
    selectTool,
    cropRatioValue,
    onCropRatioChange,
    onCropReset,
    hasCrop,
    onOrientation,
  } = useMarkEditorContext();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-text-dark">几何</h2>
        <p className="mt-1 text-xs leading-5 text-text-muted">调整图片朝向和裁剪区域</p>
      </div>

      <section className="border-b border-border-dark pb-4">
        <h3 className="mb-2 text-xs font-medium text-text-muted">朝向</h3>
        <div className="grid grid-cols-2 gap-2">
          {ORIENTATION_BUTTONS.map((button) => {
            const Icon = button.icon;
            return (
              <UiChipButton
                key={button.operation}
                type="button"
                title={button.label}
                className={CHIP_CLASS}
                onClick={() => onOrientation(button.operation)}
              >
                <Icon className={ICON_CLASS} />
                {button.label}
              </UiChipButton>
            );
          })}
        </div>
      </section>

      <section className="pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium text-text-muted">裁剪</h3>
          <UiChipButton
            type="button"
            active={tool === 'crop'}
            className={CHIP_CLASS}
            onClick={() => selectTool(tool === 'crop' ? 'select' : 'crop')}
          >
            {tool === 'crop' ? '退出裁剪' : '开始裁剪'}
          </UiChipButton>
        </div>
        <div className="flex flex-wrap gap-2">
          {CROP_RATIO_OPTIONS.map((option) => (
            <UiChipButton
              key={option.value}
              type="button"
              active={cropRatioValue === option.value}
              className={CHIP_CLASS}
              onClick={() => {
                selectTool('crop');
                onCropRatioChange(option.value);
              }}
            >
              {option.label}
            </UiChipButton>
          ))}
        </div>
        <UiChipButton
          type="button"
          className={`mt-3 ${CHIP_CLASS}`}
          onClick={onCropReset}
          disabled={!hasCrop}
        >
          <X className={ICON_CLASS} />
          清除裁剪
        </UiChipButton>
      </section>
    </div>
  );
}
