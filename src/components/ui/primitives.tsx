import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  UI_BOOLEAN_CONTROL_ACTIVE_CLASS,
  UI_BUTTON_RESET_CLASS,
  UI_FIELD_DISABLED_CLASS,
  UI_FIELD_FOCUS_CLASS,
  UI_FIELD_PADDING_CLASS,
  UI_FIELD_PLACEHOLDER_CLASS,
  UI_FIELD_SIZE_CLASS,
  UI_FIELD_SURFACE_CLASS,
  UI_GLASS_ADAPTIVE_NAV_CLASS,
  UI_GLASS_ADAPTIVE_OPTION_CLASS,
  UI_GLASS_ADAPTIVE_SELECTED_CLASS,
  UI_GLASS_ADAPTIVE_TILE_CLASS,
  UI_CONTROL_HEIGHT_CLASS,
  UI_MULTISELECT_ITEM_ACTIVE_CLASS,
  UI_NAV_INDICATOR_BOTTOM_CLASS,
  UI_NAV_INDICATOR_BOTTOM_SUBTLE_CLASS,
  UI_NAV_INDICATOR_END_CLASS,
  UI_NAV_ITEM_ACTIVE_CLASS,
  UI_NAV_ITEM_ACTIVE_SUBTLE_CLASS,
  UI_OPTION_ITEM_ACTIVE_CLASS,
  UI_OPTION_ITEM_CLASS,
  UI_RADIUS_CLASS,
} from './styleTokens';
import { useScopedTextHistoryProps } from './useScopedTextHistory';
import {
  type UiButtonProps,
  type UiCheckboxProps,
  type UiChipButtonProps,
  type UiControlSize,
  type UiFieldTriggerProps,
  type UiIconButtonProps,
  type UiInputProps,
  type UiNavButtonProps,
  type UiOptionButtonProps,
  type UiPanelProps,
  type UiRangeInputProps,
  type UiSelectProps,
  type UiSwitchProps,
  type UiTextAreaProps,
  UI_RANGE_TRACK_TONE_CLASS,
  resolveButtonSize,
  resolveButtonVariant,
  resolveIconButtonClass,
  resolveTextHistoryValue,
  resolveUiPanelSurface,
} from './primitiveInternals';
export type { UiControlSize, UiRangeTrackTone } from './primitiveInternals';

/** 选项、标签、导航共用的键盘焦点环（按钮重置类会清掉 ring，这里用 `!` 补回）。 */
const UI_ITEM_FOCUS_RING_CLASS = 'focus-visible:!ring-2 focus-visible:!ring-inset focus-visible:!ring-accent-ring';

/**
 * 文字按钮。默认 `quiet`（静息无底）；档位与尺寸见 `ButtonVariant` / `ButtonSize`。
 * 外观只由 variant/size 决定，className 只放布局类（check:surface 规则 E）。
 */
export const UiButton = forwardRef<HTMLButtonElement, UiButtonProps>(
  ({ className = '', variant = 'quiet', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      data-variant={variant}
      data-size={size}
      className={`ui-btn inline-flex select-none items-center justify-center font-medium ${resolveButtonVariant(variant)} ${resolveButtonSize(size, variant)} ${className}`}
      {...props}
    />
  )
);

UiButton.displayName = 'UiButton';

/** 纵向导航与列表导航的高度档：md 32 / lg 36（默认）/ auto（两行内容，高度随内容）。 */
const UI_NAV_SIZE_CLASS = {
  md: `${UI_CONTROL_HEIGHT_CLASS.md} gap-2 px-2.5`,
  lg: `${UI_CONTROL_HEIGHT_CLASS.lg} gap-2 px-3`,
  auto: 'min-h-control-lg gap-0.5 px-3 py-2',
} as const;

/**
 * 导航项（“正在看哪里”）：静息无底 text2、悬停出底；选中为中性选中底 + 主要文字（图标强调色）+ 末端指示条。
 * 外观只由 active / size 决定，className 只放布局（check:surface 规则 E）。
 */
export const UiNavButton = forwardRef<HTMLButtonElement, UiNavButtonProps>(
  ({ className = '', active = false, size = 'lg', ...props }, ref) => (
    <button
      ref={ref}
      data-size={size}
      className={`relative inline-flex w-full items-center border-0 text-left text-13 transition-colors ${UI_RADIUS_CLASS.control} ${UI_NAV_SIZE_CLASS[size]} ${UI_BUTTON_RESET_CLASS} ${UI_FIELD_DISABLED_CLASS} ${UI_ITEM_FOCUS_RING_CLASS} ${
        active
          ? `${UI_NAV_ITEM_ACTIVE_CLASS} ${UI_NAV_INDICATOR_END_CLASS}`
          : `${UI_GLASS_ADAPTIVE_NAV_CLASS} text-text2 hover:text-text1`
      } ${className}`}
      {...props}
    />
  )
);

UiNavButton.displayName = 'UiNavButton';

/**
 * 图标按钮。默认静默（静息无底、悬停出底），尺寸默认 md 28；`on` 表示开关开启，
 * `tone` 见 `IconButtonTone`。名称放 `title`/`aria-label`。外观不得在 className 覆盖（check:surface 规则 E）。
 */
export const UiIconButton = forwardRef<HTMLButtonElement, UiIconButtonProps>(
  ({
    className = '',
    on,
    tone = 'default',
    size = 'md',
    shape = 'square',
    ...props
  }, ref) => (
    <button
      ref={ref}
      {...props}
      data-tone={tone}
      data-size={size}
      aria-pressed={props['aria-pressed'] ?? on}
      className={`ui-btn inline-flex shrink-0 select-none items-center justify-center ${resolveIconButtonClass({ tone, size, shape, on: on === true })} ${className}`}
    />
  )
);

UiIconButton.displayName = 'UiIconButton';

/** 标签/芯片高度档：28 / 32 / 36，字号 12 / 13 / 13。 */
const UI_CHIP_SIZE_CLASS: Record<UiControlSize, string> = {
  sm: `${UI_CONTROL_HEIGHT_CLASS.sm} px-2 text-xs`,
  md: `${UI_CONTROL_HEIGHT_CLASS.md} px-2.5 text-13`,
  lg: `${UI_CONTROL_HEIGHT_CLASS.lg} px-3 text-13`,
};

/**
 * 标签按钮：默认 `toggle` 是多选/标签（选中 = 强调描边 + 中性底 + 强调文字），`navigation` 是横向导航
 * （选中 = 中性选中底 + 底部指示条；`subtle` 是面板标签：主要文字 + 底部细线）。
 * 外观只由 active / selectionRole / selectionAppearance / size 决定，className 只放布局（check:surface 规则 E）。
 */
export const UiChipButton = forwardRef<HTMLButtonElement, UiChipButtonProps>(
  ({
    className = '',
    active = false,
    selectionRole = 'toggle',
    selectionAppearance = 'default',
    size = 'md',
    ...props
  }, ref) => {
    const subtle = selectionRole === 'navigation' && selectionAppearance === 'subtle';
    const navigationActiveClass = subtle
      ? `${UI_NAV_ITEM_ACTIVE_SUBTLE_CLASS} ${UI_NAV_INDICATOR_BOTTOM_SUBTLE_CLASS}`
      : `${UI_NAV_ITEM_ACTIVE_CLASS} ${UI_NAV_INDICATOR_BOTTOM_CLASS}`;
    const stateClass = selectionRole === 'navigation'
      ? active
        ? `border-transparent ${navigationActiveClass}`
        : subtle
          ? 'border-transparent text-text3 hover:text-text2'
          : `border-transparent text-text2 hover:text-text1 ${UI_GLASS_ADAPTIVE_OPTION_CLASS}`
      : active
        ? UI_MULTISELECT_ITEM_ACTIVE_CLASS
        // 纯文字标签组：静息保留一圈发丝线（去框会变成裸文字，丢点击可供性），悬停出底
        : `border-line-strong text-text2 hover:text-text1 ${UI_GLASS_ADAPTIVE_OPTION_CLASS}`;

    return (
      <button
        ref={ref}
        data-size={size}
        className={`relative inline-flex select-none items-center gap-1.5 border transition-colors ${UI_CHIP_SIZE_CLASS[size]} ${subtle ? 'rounded-none font-medium' : UI_RADIUS_CLASS.control} ${UI_BUTTON_RESET_CLASS} ${UI_FIELD_DISABLED_CLASS} ${UI_ITEM_FOCUS_RING_CLASS} ${stateClass} ${className}`}
        {...props}
      />
    );
  }
);

UiChipButton.displayName = 'UiChipButton';

export const UiPanel = forwardRef<HTMLDivElement, UiPanelProps>(
  ({ className = '', variant = 'panel', ...props }, ref) => (
    <div
      ref={ref}
      className={`${resolveUiPanelSurface(variant)} ${className}`}
      {...props}
    />
  )
);

UiPanel.displayName = 'UiPanel';

/**
 * 中性抬升三档（segment / tile / swatch）各自的尺寸与状态；颜色在玻璃内外由 `ui-glass-adaptive-*` 统一切换。
 * 来源：1.4 外观设置为主题预设与强调色新增，2.2 接管为全局分段选择（重要记录 003）。
 */
const UI_OPTION_NEUTRAL_VARIANT_CLASS = {
  segment: {
    layout: `${UI_CONTROL_HEIGHT_CLASS.sm} justify-center rounded-md px-3 text-xs font-medium`,
    rest: `border-transparent text-text2 hover:text-text1 ${UI_GLASS_ADAPTIVE_OPTION_CLASS}`,
    active: `border-transparent text-text1 ${UI_GLASS_ADAPTIVE_SELECTED_CLASS}`,
  },
  tile: {
    layout: 'h-11 gap-2.5 rounded-lg px-2.5 text-13',
    rest: `border-transparent text-text2 hover:text-text1 ${UI_GLASS_ADAPTIVE_TILE_CLASS} ${UI_GLASS_ADAPTIVE_OPTION_CLASS}`,
    active: `border-transparent text-text1 ${UI_GLASS_ADAPTIVE_SELECTED_CLASS}`,
  },
  // 色样：颜色由调用点经 style.backgroundColor / backgroundImage 传入，bg-clip-content 让它只铺内圈；
  // 外圈 2px 边框 + 2px 间隙表达选中（按钮重置类会清掉 outline/ring，所以不用它们，也不会被父级裁切）。
  swatch: {
    layout: 'h-8 w-8 shrink-0 justify-center rounded-full border-2 p-0.5 bg-clip-content',
    rest: 'border-transparent hover:border-line-strong',
    active: 'border-text1',
  },
} as const;

/** 选项的高度与字号档（default / card / flat / menu / grid）。不传 size 时高度随内容。 */
const UI_OPTION_SIZE_CLASS: Record<UiControlSize | 'auto', string> = {
  auto: 'px-2.5 py-2',
  sm: 'min-h-control-sm px-2 py-1 text-xs',
  md: 'min-h-control-md px-2.5 py-1 text-13',
  lg: 'min-h-control-lg px-3 py-1.5 text-13',
};

/**
 * 选项按钮。选中语义见 `selection`：单选中性抬升（重要记录 003），多选强调描边 + 强调文字。
 * 外观只由 variant / size / active / selection 决定，className 只放布局（check:surface 规则 E）。
 */
export const UiOptionButton = forwardRef<HTMLButtonElement, UiOptionButtonProps>(
  ({ className = '', active = false, variant = 'default', size, selection = 'single', highlighted = false, ...props }, ref) => {
    if (variant === 'segment' || variant === 'tile' || variant === 'swatch') {
      const neutral = UI_OPTION_NEUTRAL_VARIANT_CLASS[variant];
      return (
        <button
          ref={ref}
          className={`inline-flex items-center border transition-colors ${UI_BUTTON_RESET_CLASS} ${UI_FIELD_DISABLED_CLASS} ${UI_ITEM_FOCUS_RING_CLASS} ${neutral.layout} ${active ? neutral.active : neutral.rest} ${className}`}
          {...props}
        />
      );
    }

    const activeClass = selection === 'multiple' ? UI_MULTISELECT_ITEM_ACTIVE_CLASS : UI_OPTION_ITEM_ACTIVE_CLASS;
    // 静息态的 hover 一律交给 UI_GLASS_ADAPTIVE_OPTION_CLASS：写成 `hover:bg-hover` 在玻璃里会赢，
    // 把半透明选项盖成一块实心贴片。menu 静息不描边不铺底；grid / card / flat 铺 raised 撑出格子（玻璃内换控件纱）；
    // 默认变体是纯文字 chip 组，保留一圈发丝线。
    const highlightClass = highlighted ? ' ui-option-highlighted' : '';
    const restClass = (() => {
      if (variant === 'menu') {
        return `border-transparent text-text1 ${UI_GLASS_ADAPTIVE_OPTION_CLASS}${highlightClass}`;
      }
      if (variant === 'grid' || variant === 'card' || variant === 'flat') {
        return `border-transparent text-text1 ${UI_GLASS_ADAPTIVE_TILE_CLASS} ${UI_GLASS_ADAPTIVE_OPTION_CLASS}${highlightClass}`;
      }
      return `${UI_OPTION_ITEM_CLASS} ${UI_GLASS_ADAPTIVE_OPTION_CLASS}${highlightClass}`;
    })();

    return (
      <button
        ref={ref}
        data-size={size ?? 'auto'}
        className={`inline-flex items-center rounded-lg border text-left transition-colors ${UI_OPTION_SIZE_CLASS[size ?? 'auto']} ${UI_BUTTON_RESET_CLASS} ${UI_FIELD_DISABLED_CLASS} ${UI_ITEM_FOCUS_RING_CLASS} ${active ? activeClass : restClass} ${className}`}
        {...props}
      />
    );
  }
);

UiOptionButton.displayName = 'UiOptionButton';

const UI_TEXT_AREA_CLASS = `w-full resize-none ${UI_RADIUS_CLASS.field} px-2.5 py-2 text-13 leading-5 ${UI_FIELD_PLACEHOLDER_CLASS} ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS}`;

export function UiTextArea({ className = '', textHistory, value, ...props }: UiTextAreaProps): JSX.Element {
  const historyProps = useScopedTextHistoryProps(
    resolveTextHistoryValue(value),
    textHistory,
    props
  );
  return (
    <textarea
      value={value}
      className={`${UI_TEXT_AREA_CLASS} ${className}`}
      {...props}
      {...historyProps}
    />
  );
}

export const UiTextAreaField = forwardRef<HTMLTextAreaElement, UiTextAreaProps>(
  ({ className = '', textHistory, value, ...props }, ref) => {
    const historyProps = useScopedTextHistoryProps(
      resolveTextHistoryValue(value),
      textHistory,
      props
    );
    return (
      <textarea
        ref={ref}
        value={value}
        className={`${UI_TEXT_AREA_CLASS} ${className}`}
        {...props}
        {...historyProps}
      />
    );
  }
);

UiTextAreaField.displayName = 'UiTextAreaField';

/**
 * 单行输入。raised 字段表面、无边框，聚焦一圈强调色焦点环；高度与字号只由 `size` 决定（sm 28 / md 32 / lg 36）。
 */
export const UiInput = forwardRef<HTMLInputElement, UiInputProps>(
  ({ className = '', textHistory, value, size = 'md', ...props }, ref) => {
    const historyProps = useScopedTextHistoryProps(
      resolveTextHistoryValue(value),
      textHistory,
      props
    );
    return (
      <input
        ref={ref}
        value={value}
        data-size={size}
        className={`w-full py-0 leading-5 ${UI_FIELD_SIZE_CLASS[size]} ${UI_FIELD_PADDING_CLASS[size]} ${UI_FIELD_PLACEHOLDER_CLASS} ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
        {...props}
        {...historyProps}
      />
    );
  }
);

UiInput.displayName = 'UiInput';

export const UiRangeInput = forwardRef<HTMLInputElement, UiRangeInputProps>(
  ({ className = '', trackTone = 'neutral', ...props }, ref) => (
    <input
      ref={ref}
      type="range"
      className={`h-6 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none
      [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full
      [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-text1 [&::-webkit-slider-thumb]:shadow-thumb-sm
      [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full
      [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-text1
      focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-accent-ring
      ${UI_RANGE_TRACK_TONE_CLASS[trackTone]}
      ${className}`}
      {...props}
    />
  )
);

UiRangeInput.displayName = 'UiRangeInput';

export const UiColorInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      type="color"
      className={`ui-color-input-spectrum h-9 w-9 cursor-pointer appearance-none rounded-full border-0 p-0 ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
      {...props}
    />
  )
);

UiColorInput.displayName = 'UiColorInput';

/** 复选框：强调色只进入框体本身（开态强调实底 + on-accent 勾），整行保持静息。 */
export const UiCheckbox = forwardRef<HTMLButtonElement, UiCheckboxProps>(
  ({ className = '', checked, onCheckedChange, onClick, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors duration-120 ${UI_FIELD_DISABLED_CLASS} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
        checked
          ? UI_BOOLEAN_CONTROL_ACTIVE_CLASS
          : 'border-line-strong bg-raised text-transparent hover:border-text3'
      } ${className}`}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onCheckedChange?.(!checked);
        }
      }}
      {...props}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
    </button>
  )
);

UiCheckbox.displayName = 'UiCheckbox';

/**
 * 开关。`pill`：强调色只进入开态轨道（滑块取 on-accent）；`segmented`：两段文字的分段外观，
 * 与 `UiOptionButton variant="segment"` 同一套中性抬升（重要记录 003），仍是 role=switch。
 */
export const UiSwitch = forwardRef<HTMLButtonElement, UiSwitchProps>(
  ({ className = '', checked, onCheckedChange, onClick, appearance = 'pill', offLabel, onLabel, size = 'field', ...props }, ref) => {
    const handleClick: ButtonHTMLAttributes<HTMLButtonElement>['onClick'] = (event) => {
      onClick?.(event);
      if (!event.defaultPrevented) {
        onCheckedChange?.(!checked);
      }
    };

    if (appearance === 'segmented') {
      const sizeClass = size === 'compact'
        ? `${UI_CONTROL_HEIGHT_CLASS.sm} w-20 text-xs`
        : `${UI_CONTROL_HEIGHT_CLASS.md} w-28 text-13`;

      return (
        <button
          ref={ref}
          type="button"
          role="switch"
          aria-checked={checked}
          className={`relative inline-grid grid-cols-2 items-stretch rounded-lg bg-gap/60 p-0.5 font-medium transition-colors duration-120 ${UI_BUTTON_RESET_CLASS} ${UI_FIELD_DISABLED_CLASS} focus-visible:!ring-2 focus-visible:!ring-accent-ring ${sizeClass} ${className}`}
          onClick={handleClick}
          {...props}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%_-_0.125rem)] rounded-md transition-transform duration-180 ${UI_GLASS_ADAPTIVE_SELECTED_CLASS} ${
              checked ? 'translate-x-full' : 'translate-x-0'
            }`}
          />
          <span
            className={`pointer-events-none relative flex min-w-0 items-center justify-center transition-colors duration-180 ${
              checked ? 'text-text2' : 'text-text1'
            }`}
          >
            {offLabel}
          </span>
          <span
            className={`pointer-events-none relative flex min-w-0 items-center justify-center transition-colors duration-180 ${
              checked ? 'text-text1' : 'text-text2'
            }`}
          >
            {onLabel}
          </span>
        </button>
      );
    }

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-0 transition-colors duration-120 ${
          checked
            ? UI_BOOLEAN_CONTROL_ACTIVE_CLASS
            : 'bg-control-pressed hover:bg-line-strong'
        } ${UI_BUTTON_RESET_CLASS} ${UI_FIELD_DISABLED_CLASS} focus-visible:!ring-2 focus-visible:!ring-accent-ring ${className}`}
        onClick={handleClick}
        {...props}
      >
        {/* 开态滑块取 on-accent（与强调色对比 ≥ 4.5 的黑或白），关态取主要文字色：深浅主题都清楚 */}
        <span
          className={`pointer-events-none ml-0.5 h-4 w-4 rounded-full shadow-thumb-sm transition-transform duration-120 ${
            checked ? 'translate-x-4 bg-on-accent' : 'translate-x-0 bg-text1'
          }`}
        />
      </button>
    );
  }
);

UiSwitch.displayName = 'UiSwitch';

/**
 * 原生选择。弹出列表由系统绘制：根节点的 `color-scheme`（主题引擎写入）决定深浅，
 * 选项的底与字再显式取 raised / text1，纸白等浅色主题下弹出列表不再是深色。
 */
export function UiSelect({ className = '', children, size = 'md', ...props }: UiSelectProps) {
  return (
    <div className="relative">
      <select
        data-size={size}
        className={`w-full appearance-none py-0 pr-8 [color-scheme:inherit] [&_option]:bg-raised [&_option]:text-text1 ${UI_FIELD_SIZE_CLASS[size]} ${UI_FIELD_PADDING_CLASS[size]} ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text3" />
    </div>
  );
}

/** 字段触发器的外观：`field` = raised 字段表面；`quiet` = 静默按钮皮肤（标题栏、工具栏里的弱化入口）。 */
function resolveFieldTriggerClass(size: UiControlSize, appearance: 'field' | 'quiet'): string {
  if (appearance === 'quiet') {
    return `ui-btn ui-btn-quiet ${UI_FIELD_SIZE_CLASS[size]} px-2`;
  }
  return `${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_SIZE_CLASS[size]} ${UI_FIELD_PADDING_CLASS[size]} hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring`;
}

/**
 * 字段触发器：`Dropdown` / `PanelTrigger` 打开浮层的那颗按钮（值 + 下箭头）。
 * 高度与字号只由 `size` 决定（与 UiInput 同档），外观只由 `appearance` 决定；className 只放宽度等布局。
 */
export const UiFieldTrigger = forwardRef<HTMLButtonElement, UiFieldTriggerProps>(
  ({ className = '', size = 'md', appearance = 'field', open = false, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-size={size}
      data-appearance={appearance}
      className={`inline-flex min-w-0 select-none items-center justify-between gap-1.5 whitespace-nowrap font-normal transition-colors duration-120 ${resolveFieldTriggerClass(size, appearance)} ${UI_FIELD_DISABLED_CLASS} ${className}`}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-text3 transition-transform duration-180 ${open ? 'rotate-180' : ''}`} />
    </button>
  )
);

UiFieldTrigger.displayName = 'UiFieldTrigger';

interface UiNumberStepperProps {
  size: UiControlSize;
  increaseLabel: string;
  decreaseLabel: string;
  disabled?: boolean;
  canIncrease: boolean;
  canDecrease: boolean;
  onStep: (direction: 1 | -1) => void;
}

/**
 * 数值字段内置的上下步进列（`NumberInput` 专用）：16px 宽、上下各占一半高度，静息 text3、悬停出底。
 * 不进 Tab 序列（键盘用上下键步进）；按下不抢走输入框焦点。
 */
export function UiNumberStepper({
  size,
  increaseLabel,
  decreaseLabel,
  disabled = false,
  canIncrease,
  canDecrease,
  onStep,
}: UiNumberStepperProps): JSX.Element {
  const iconClass = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3';
  const buttonClass = 'flex h-1/2 w-full items-center justify-center text-text3 transition-colors duration-120 hover:bg-hover hover:text-text1 disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent';
  const renderButton = (direction: 1 | -1) => (
    <button
      type="button"
      tabIndex={-1}
      data-ui-compact-stepper-button
      title={direction === 1 ? increaseLabel : decreaseLabel}
      aria-label={direction === 1 ? increaseLabel : decreaseLabel}
      disabled={disabled || (direction === 1 ? !canIncrease : !canDecrease)}
      className={buttonClass}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onStep(direction);
      }}
    >
      {direction === 1
        ? <ChevronDown className={`${iconClass} rotate-180`} strokeWidth={2.4} />
        : <ChevronDown className={iconClass} strokeWidth={2.4} />}
    </button>
  );
  return (
    <div className="flex w-4 shrink-0 flex-col">
      {renderButton(1)}
      {renderButton(-1)}
    </div>
  );
}
