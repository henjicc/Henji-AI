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
import { UiChipButton, UiColorInput, UiIconButton, UiRangeInput } from '@/components/ui';
import { IMAGE_EDITOR_PRESET_COLORS } from '@/core/theme/colorTokens';
import {
  MAX_LINE_WIDTH_PERCENT,
  MAX_MOSAIC_STRENGTH_PERCENT,
  MAX_TEXT_SIZE_PERCENT,
  MIN_LINE_WIDTH_PERCENT,
  MIN_MOSAIC_STRENGTH_PERCENT,
  MIN_TEXT_SIZE_PERCENT,
} from '../domain/metrics';
import { useRef } from 'react';
import type { MarkToolType } from '../domain/types';
import type { OrientationOp } from '../domain/geometry';
import { CROP_RATIO_OPTIONS, TOOL_BUTTONS, type MarkEditorStyleState } from './shared';
import { useNonPassiveWheel } from './useNonPassiveWheel';
import type { NumericStyleKey } from './useMarkController';

interface MarkToolbarProps {
  variant?: 'legacy' | 'annotation';
  tool: MarkToolType;
  setTool: (tool: MarkToolType) => void;
  style: MarkEditorStyleState;
  onStylePatch: (patch: Partial<MarkEditorStyleState>) => void;
  /** 滑块悬停滚轮微调 */
  onStyleWheel: (key: NumericStyleKey, deltaY: number) => void;
  cropRatioValue: string;
  onCropRatioChange: (value: string) => void;
  onCropReset: () => void;
  hasCrop: boolean;
  onOrientation: (op: OrientationOp) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  /** 宿主动作(如 取消/保存),固定在工具行最右侧 */
  actions?: React.ReactNode;
}

const CHIP_CLASS = '!h-8 !gap-1 !px-2.5 !py-1.5 !text-xs';
const ICON_CLASS = 'h-3.5 w-3.5';

const ORIENTATION_BUTTONS: { op: OrientationOp; label: string; icon: typeof RotateCw }[] = [
  { op: 'rotate-ccw', label: '左转', icon: RotateCcw },
  { op: 'rotate-cw', label: '右转', icon: RotateCw },
  { op: 'flip-h', label: '水平翻转', icon: FlipHorizontal2 },
  { op: 'flip-v', label: '垂直翻转', icon: FlipVertical2 },
];

export function MarkToolbar({
  variant = 'legacy',
  tool,
  setTool,
  style,
  onStylePatch,
  onStyleWheel,
  cropRatioValue,
  onCropRatioChange,
  onCropReset,
  hasCrop,
  onOrientation,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
  canClear,
  actions,
}: MarkToolbarProps): JSX.Element {
  const annotationOnly = variant === 'annotation';
  const showWidth =
    tool === 'callout' || tool === 'rect' || tool === 'ellipse' || tool === 'arrow' || tool === 'pen' || tool === 'select';
  const showTextSize = tool === 'callout' || tool === 'text' || tool === 'number' || tool === 'select';
  const showColor = tool !== 'crop' && tool !== 'mosaic';

  const widthSliderRef = useRef<HTMLDivElement>(null);
  const textSizeSliderRef = useRef<HTMLDivElement>(null);
  const mosaicSliderRef = useRef<HTMLDivElement>(null);
  useNonPassiveWheel(widthSliderRef, (event) => {
    event.preventDefault();
    onStyleWheel('lineWidthPercent', event.deltaY);
  }, tool);
  useNonPassiveWheel(textSizeSliderRef, (event) => {
    event.preventDefault();
    onStyleWheel('textSizePercent', event.deltaY);
  }, tool);
  useNonPassiveWheel(mosaicSliderRef, (event) => {
    event.preventDefault();
    onStyleWheel('mosaicStrengthPercent', event.deltaY);
  }, tool);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        {actions && <div className="invisible flex shrink-0 items-center gap-2" aria-hidden>{actions}</div>}
        <div className="flex flex-1 flex-wrap items-center justify-center gap-2">
          {TOOL_BUTTONS.filter((button) => !annotationOnly || button.type !== 'crop').map((button) => {
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

          {!annotationOnly && (
            <>
              <span className="mx-1 h-5 w-px bg-border-dark" />
              {ORIENTATION_BUTTONS.map((button) => {
                const Icon = button.icon;
                return (
                  <UiChipButton
                    key={button.op}
                    type="button"
                    title={button.label}
                    className={CHIP_CLASS}
                    onClick={() => onOrientation(button.op)}
                  >
                    <Icon className={ICON_CLASS} />
                    {button.label}
                  </UiChipButton>
                );
              })}
            </>
          )}

          <span className="mx-1 h-5 w-px bg-border-dark" />

          <UiChipButton type="button" className={CHIP_CLASS} onClick={onUndo} disabled={!canUndo} title="撤销(Ctrl+Z)">
            <Undo2 className={ICON_CLASS} />
            撤销
          </UiChipButton>
          <UiChipButton type="button" className={CHIP_CLASS} onClick={onRedo} disabled={!canRedo} title="重做(Ctrl+Y)">
            <Redo2 className={ICON_CLASS} />
            重做
          </UiChipButton>
          <UiChipButton type="button" className={CHIP_CLASS} onClick={onClear} disabled={!canClear} title="清空全部标记">
            <Trash2 className={ICON_CLASS} />
            清空
          </UiChipButton>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {/* 选项行:固定最小高度,切换工具不引起内容跳动 */}
      <div className="flex min-h-[36px] flex-wrap items-center justify-center gap-2">
        {!annotationOnly && tool === 'crop' ? (
          <>
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
          </>
        ) : tool === 'mosaic' ? (
          <>
            <UiChipButton
              type="button"
              active={style.mosaicMode === 'pixel'}
              onClick={() => onStylePatch({ mosaicMode: 'pixel' })}
              className={CHIP_CLASS}
            >
              马赛克
            </UiChipButton>
            <UiChipButton
              type="button"
              active={style.mosaicMode === 'blur'}
              onClick={() => onStylePatch({ mosaicMode: 'blur' })}
              className={CHIP_CLASS}
            >
              高斯模糊
            </UiChipButton>
            <div ref={mosaicSliderRef} className="flex items-center gap-2" title="滚轮可调">
              <span className="text-xs text-text-muted">强度</span>
              <UiRangeInput
                min={MIN_MOSAIC_STRENGTH_PERCENT}
                max={MAX_MOSAIC_STRENGTH_PERCENT}
                step={0.5}
                value={Number(style.mosaicStrengthPercent.toFixed(1))}
                onChange={(event) => onStylePatch({ mosaicStrengthPercent: Number(event.target.value) })}
                className="!w-36"
              />
              <span className="w-9 text-xs text-text-muted">{style.mosaicStrengthPercent.toFixed(1)}%</span>
            </div>
            <span className="text-xs text-text-muted">拖拽框选需要打码的区域</span>
          </>
        ) : (
          <>
            {tool === 'callout' && (
              <div className="mr-1 flex items-center gap-1">
                <span className="text-xs text-text-muted">形状</span>
                <UiChipButton
                  type="button"
                  active={style.calloutShape === 'rect'}
                  onClick={() => onStylePatch({ calloutShape: 'rect' })}
                  className={CHIP_CLASS}
                >
                  矩形
                </UiChipButton>
                <UiChipButton
                  type="button"
                  active={style.calloutShape === 'ellipse'}
                  onClick={() => onStylePatch({ calloutShape: 'ellipse' })}
                  className={CHIP_CLASS}
                >
                  圆形
                </UiChipButton>
              </div>
            )}
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
                  className="!h-8"
                />
              </>
            )}
            {showWidth && (
              <div ref={widthSliderRef} className="flex items-center gap-2" title="滚轮可调;选中图形后在画布上滚轮也可调">
                <span className="text-xs text-text-muted">线宽</span>
                <UiRangeInput
                  min={MIN_LINE_WIDTH_PERCENT}
                  max={MAX_LINE_WIDTH_PERCENT}
                  step={0.1}
                  value={Number(style.lineWidthPercent.toFixed(1))}
                  onChange={(event) => onStylePatch({ lineWidthPercent: Number(event.target.value) })}
                  className="!w-36"
                />
                <span className="w-9 text-xs text-text-muted">{style.lineWidthPercent.toFixed(1)}%</span>
              </div>
            )}
            {showTextSize && (
              <div ref={textSizeSliderRef} className="flex items-center gap-2" title="滚轮可调">
                <span className="text-xs text-text-muted">字号</span>
                <UiRangeInput
                  min={MIN_TEXT_SIZE_PERCENT}
                  max={MAX_TEXT_SIZE_PERCENT}
                  step={0.5}
                  value={Number(style.textSizePercent.toFixed(1))}
                  onChange={(event) => onStylePatch({ textSizePercent: Number(event.target.value) })}
                  className="!w-36"
                />
                <span className="w-9 text-xs text-text-muted">{style.textSizePercent.toFixed(1)}%</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
