import {
  FlipHorizontal2,
  FlipVertical2,
  Redo2,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { UiChipButton, UiColorInput, UiIconButton, UiInput, UiRangeInput } from '@/components/ui';
import { IMAGE_EDITOR_PRESET_COLORS } from '@/core/theme/colorTokens';
import {
  MAX_LINE_WIDTH_PERCENT,
  MAX_TEXT_SIZE_PERCENT,
  MIN_LINE_WIDTH_PERCENT,
  MIN_TEXT_SIZE_PERCENT,
} from '../domain/metrics';
import type { MarkToolType } from '../domain/types';
import type { OrientationOp } from '../domain/geometry';
import { CROP_RATIO_OPTIONS, TOOL_BUTTONS, type MarkEditorStyleState } from './shared';

interface MarkToolbarProps {
  tool: MarkToolType;
  setTool: (tool: MarkToolType) => void;
  style: MarkEditorStyleState;
  onStylePatch: (patch: Partial<MarkEditorStyleState>) => void;
  cropRatioValue: string;
  onCropRatioChange: (value: string) => void;
  onCropReset: () => void;
  hasCrop: boolean;
  onOrientation: (op: OrientationOp) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelected: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canDeleteSelected: boolean;
  canClear: boolean;
}

const CHIP_CLASS = '!h-8 !gap-1 !px-2.5 !py-1.5 !text-xs';
const ICON_CLASS = 'h-3.5 w-3.5';

const ORIENTATION_BUTTONS: { op: OrientationOp; title: string; icon: typeof RotateCw }[] = [
  { op: 'rotate-ccw', title: '逆时针旋转 90°', icon: RotateCcw },
  { op: 'rotate-cw', title: '顺时针旋转 90°', icon: RotateCw },
  { op: 'flip-h', title: '水平翻转', icon: FlipHorizontal2 },
  { op: 'flip-v', title: '垂直翻转', icon: FlipVertical2 },
];

export function MarkToolbar({
  tool,
  setTool,
  style,
  onStylePatch,
  cropRatioValue,
  onCropRatioChange,
  onCropReset,
  hasCrop,
  onOrientation,
  onUndo,
  onRedo,
  onDeleteSelected,
  onClear,
  canUndo,
  canRedo,
  canDeleteSelected,
  canClear,
}: MarkToolbarProps): JSX.Element {
  const showWidth = tool === 'rect' || tool === 'ellipse' || tool === 'arrow' || tool === 'pen' || tool === 'select';
  const showTextSize = tool === 'text' || tool === 'number' || tool === 'select';
  const showColor = tool !== 'crop' && tool !== 'mosaic';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {TOOL_BUTTONS.map((button) => {
          const Icon = button.icon;
          return (
            <UiChipButton
              key={button.type}
              type="button"
              active={tool === button.type}
              title={`${button.label}(${button.shortcut})`}
              onClick={() => setTool(button.type)}
              className={CHIP_CLASS}
            >
              <Icon className={ICON_CLASS} />
              {button.label}
            </UiChipButton>
          );
        })}

        <span className="mx-1 h-5 w-px bg-border-dark" />

        {ORIENTATION_BUTTONS.map((button) => {
          const Icon = button.icon;
          return (
            <UiIconButton
              key={button.op}
              type="button"
              title={button.title}
              className="h-8 w-8"
              onClick={() => onOrientation(button.op)}
            >
              <Icon className={ICON_CLASS} />
            </UiIconButton>
          );
        })}

        <span className="mx-1 h-5 w-px bg-border-dark" />

        <UiChipButton type="button" className={CHIP_CLASS} onClick={onUndo} disabled={!canUndo} title="撤销(Ctrl+Z)">
          <Undo2 className={ICON_CLASS} />
          撤销
        </UiChipButton>
        <UiChipButton type="button" className={CHIP_CLASS} onClick={onRedo} disabled={!canRedo} title="重做(Ctrl+Y)">
          <Redo2 className={ICON_CLASS} />
          重做
        </UiChipButton>
        <UiChipButton
          type="button"
          className={CHIP_CLASS}
          onClick={onDeleteSelected}
          disabled={!canDeleteSelected}
          title="删除选中(Delete)"
        >
          <Trash2 className={ICON_CLASS} />
          删除选中
        </UiChipButton>
        <UiChipButton type="button" className={CHIP_CLASS} onClick={onClear} disabled={!canClear}>
          <Trash2 className={ICON_CLASS} />
          清空
        </UiChipButton>
      </div>

      {tool === 'crop' ? (
        <div className="flex flex-wrap items-center gap-2">
          {CROP_RATIO_OPTIONS.map((option) => (
            <UiChipButton
              key={option.value}
              type="button"
              active={cropRatioValue === option.value}
              onClick={() => onCropRatioChange(option.value)}
              className={CHIP_CLASS}
            >
              {option.label}
            </UiChipButton>
          ))}
          <UiChipButton
            type="button"
            className={CHIP_CLASS}
            onClick={onCropReset}
            disabled={!hasCrop}
          >
            <X className={ICON_CLASS} />
            清除裁剪
          </UiChipButton>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {showColor && (
            <>
              <div className="flex items-center gap-1">
                {IMAGE_EDITOR_PRESET_COLORS.slice(0, 9).map((presetColor, index) => (
                  <UiIconButton
                    key={presetColor}
                    type="button"
                    title={`颜色 ${index + 1}(按 ${index + 1})`}
                    className={`h-6 w-6 rounded-full border-2 ${
                      style.color.toLowerCase() === presetColor.toLowerCase()
                        ? 'border-white/90'
                        : 'border-transparent'
                    }`}
                    onClick={() => onStylePatch({ color: presetColor })}
                  >
                    <span
                      className="block h-3.5 w-3.5 rounded-full"
                      style={{ backgroundColor: presetColor }}
                    />
                  </UiIconButton>
                ))}
              </div>
              <UiColorInput
                value={style.color}
                onChange={(event) => onStylePatch({ color: event.target.value })}
              />
            </>
          )}
          {showWidth && (
            <>
              <UiRangeInput
                min={MIN_LINE_WIDTH_PERCENT}
                max={MAX_LINE_WIDTH_PERCENT}
                step={0.1}
                value={Number(style.lineWidthPercent.toFixed(1))}
                onChange={(event) => onStylePatch({ lineWidthPercent: Number(event.target.value) })}
              />
              <span className="w-12 text-xs text-text-muted">线宽 {style.lineWidthPercent.toFixed(1)}%</span>
            </>
          )}
          {showTextSize && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-text-muted">字号</span>
              <UiInput
                type="number"
                min={MIN_TEXT_SIZE_PERCENT}
                max={MAX_TEXT_SIZE_PERCENT}
                step={0.5}
                value={Number(style.textSizePercent.toFixed(1))}
                onChange={(event) => onStylePatch({ textSizePercent: Number(event.target.value) })}
                className="h-8 w-20 px-2"
              />
              <span className="text-xs text-text-muted">%</span>
            </div>
          )}
          {tool === 'mosaic' && (
            <span className="text-xs text-text-muted">拖拽框选需要打码的区域</span>
          )}
        </div>
      )}
    </div>
  );
}
