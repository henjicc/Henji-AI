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
import { UiButton, UiChipButton, UiColorInput, UiIconButton, UiOptionButton, UiRangeInput } from '@/components/ui';
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
  /** 宿主前导内容(返回、打开文件、文件名),固定在命令带最左侧 */
  leading?: React.ReactNode;
  /** 宿主动作(如 取消/保存),固定在命令带最右侧 */
  actions?: React.ReactNode;
}

const CHIP_CLASS = '!h-8 !gap-1 !px-2.5 !py-1.5 !text-xs'
// 单选参数值走 UiOptionButton，尺寸与命令带 chip 对齐
const OPTION_CLASS = 'h-8 gap-1 px-2.5 py-1.5 text-xs';
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
  leading,
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
    <div className="flex flex-col gap-1.5">
      {/* 命令带:左(前导) / 中(工具组,视觉居中) / 右(宿主动作)。整个视图只有这一条,
          不要在它上下再加带（见 skill henji-ui-surface 的「页面骨架:横向条带」）。
          三列取 1fr auto 1fr:左右两侧各自不超出 1fr 时,中列精确居中于命令带;
          某侧内容更宽时该列被撑开、中列相应偏移,但不会与两侧重叠。 */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">{leading}</div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {/* 工具是「模式」不是「动作」：点它改变的是接下来会发生什么，属于导航语义。
              所以静息态不描边（同质选项集合逐个描边只剩视觉重量），选中态用中性层底 +
              强调文字，而不是实底蓝——实底蓝留给命令带右端唯一的主动作。 */}
          {TOOL_BUTTONS.filter((button) => !annotationOnly || button.type !== 'crop').map((button) => {
            const Icon = button.icon;
            return (
              <UiChipButton
                key={button.type}
                type="button"
                active={tool === button.type}
                selectionRole="navigation"
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
                  <UiButton
                    key={button.op}
                    type="button"
                    variant="plain"
                    size="sm"
                    title={button.label}
                    onClick={() => onOrientation(button.op)}
                  >
                    <Icon className={`mr-1 ${ICON_CLASS}`} />
                    {button.label}
                  </UiButton>
                );
              })}
            </>
          )}

          <span className="mx-1 h-5 w-px bg-border-dark" />

          {/* 历史动作是动作不是选项:走 hover-only 图标,既不与工具组抢视觉权重,
              也让工具组窄下来后能真正居中 */}
          <UiIconButton
            type="button"
            showBorder={false}
            appearance="hover-only"
            className="h-8 w-8"
            onClick={onUndo}
            disabled={!canUndo}
            title="撤销(Ctrl+Z)"
            aria-label="撤销"
          >
            <Undo2 className={ICON_CLASS} />
          </UiIconButton>
          <UiIconButton
            type="button"
            showBorder={false}
            appearance="hover-only"
            className="h-8 w-8"
            onClick={onRedo}
            disabled={!canRedo}
            title="重做(Ctrl+Y)"
            aria-label="重做"
          >
            <Redo2 className={ICON_CLASS} />
          </UiIconButton>
          <UiIconButton
            type="button"
            showBorder={false}
            appearance="hover-only"
            hoverVariant="danger"
            className="h-8 w-8"
            onClick={onClear}
            disabled={!canClear}
            title="清空全部标记"
            aria-label="清空全部标记"
          >
            <Trash2 className={ICON_CLASS} />
          </UiIconButton>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2">{actions}</div>
      </div>

      {/* 从属参数带:只随当前工具变化,不自带底色与边框,与命令带共用外壳那条 border-b。
          固定最小高度,切换工具不引起内容跳动。 */}
      <div className="flex min-h-9 flex-wrap items-center justify-center gap-2">
        {!annotationOnly && tool === 'crop' ? (
          <>
            {CROP_RATIO_OPTIONS.map((option) => (
              <UiOptionButton
                key={option.value}
                type="button"
                variant="flat"
                active={cropRatioValue === option.value}
                onClick={() => onCropRatioChange(option.value)}
                className={OPTION_CLASS}
              >
                {option.label}
              </UiOptionButton>
            ))}
            <UiButton
              type="button"
              variant="plain"
              size="sm"
              onClick={onCropReset}
              disabled={!hasCrop}
            >
              <X className={`mr-1 ${ICON_CLASS}`} />
              清除裁剪
            </UiButton>
          </>
        ) : tool === 'mosaic' ? (
          <>
            <UiOptionButton
              type="button"
              variant="flat"
              active={style.mosaicMode === 'pixel'}
              onClick={() => onStylePatch({ mosaicMode: 'pixel' })}
              className={OPTION_CLASS}
            >
              马赛克
            </UiOptionButton>
            <UiOptionButton
              type="button"
              variant="flat"
              active={style.mosaicMode === 'blur'}
              onClick={() => onStylePatch({ mosaicMode: 'blur' })}
              className={OPTION_CLASS}
            >
              高斯模糊
            </UiOptionButton>
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
                <UiOptionButton
                  type="button"
                  variant="flat"
                  active={style.calloutShape === 'rect'}
                  onClick={() => onStylePatch({ calloutShape: 'rect' })}
                  className={OPTION_CLASS}
                >
                  矩形
                </UiOptionButton>
                <UiOptionButton
                  type="button"
                  variant="flat"
                  active={style.calloutShape === 'ellipse'}
                  onClick={() => onStylePatch({ calloutShape: 'ellipse' })}
                  className={OPTION_CLASS}
                >
                  圆形
                </UiOptionButton>
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
