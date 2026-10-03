import { Crop, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, X } from 'lucide-react';
import {
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_PANEL_TITLE_CLASS,
  UiButton,
  UiChipButton,
  UiGroup,
  UiOptionButton,
} from '@/components/ui';
import { CROP_RATIO_OPTIONS } from '@/features/imageMark/editor/shared';
import type { OrientationOp } from '@/features/imageMark/domain/geometry';
import { useMarkEditorContext } from '@/features/imageMark/editor/useMarkEditorContext';

const ICON_CLASS = 'h-4 w-4';
const OPTION_CLASS = 'justify-center gap-1.5 px-2.5';

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
        <h2 className={UI_TEXT_PANEL_TITLE_CLASS}>几何</h2>
        <p className={`mt-1 leading-5 ${UI_TEXT_META_CLASS}`}>调整图片朝向和裁剪区域</p>
      </div>

      <UiGroup title="朝向" titleTone="overline">
        <div className="grid grid-cols-2 gap-2">
          {ORIENTATION_BUTTONS.map((button) => {
            const Icon = button.icon;
            return (
              <UiButton
                key={button.operation}
                type="button"
                title={button.label}
                onClick={() => onOrientation(button.operation)}
              >
                <Icon className={`mr-1.5 ${ICON_CLASS}`} />
                {button.label}
              </UiButton>
            );
          })}
        </div>
      </UiGroup>

      <UiGroup divided className="pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className={UI_TEXT_LABEL_CLASS}>裁剪</h3>
          {/* 裁剪是“接下来拖动会发生什么”的模式，不是立刻发生的动作：用选中态语言，不占动作档位 */}
          <UiChipButton
            type="button"
            selectionRole="navigation"
            size="sm"
            active={tool === 'crop'}
            aria-pressed={tool === 'crop'}
            title={tool === 'crop' ? '退出裁剪模式' : '进入裁剪模式'}
            onClick={() => selectTool(tool === 'crop' ? 'select' : 'crop')}
          >
            <Crop className={ICON_CLASS} />
            裁剪模式
          </UiChipButton>
        </div>
        <div className="flex flex-wrap gap-2">
          {CROP_RATIO_OPTIONS.map((option) => (
            <UiOptionButton
              key={option.value}
              type="button"
              variant="flat"
              active={cropRatioValue === option.value}
              size="lg"
              className={OPTION_CLASS}
              onClick={() => {
                selectTool('crop');
                onCropRatioChange(option.value);
              }}
            >
              {option.label}
            </UiOptionButton>
          ))}
        </div>
        <UiButton
          type="button"
          className="mt-3"
          onClick={onCropReset}
          disabled={!hasCrop}
        >
          <X className={`mr-1.5 ${ICON_CLASS}`} />
          清除裁剪
        </UiButton>
      </UiGroup>
    </div>
  );
}
