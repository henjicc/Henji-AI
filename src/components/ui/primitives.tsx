import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  UI_BOOLEAN_CONTROL_ACTIVE_CLASS,
  UI_BUTTON_RESET_CLASS,
  UI_COLOR_ACCENT_FILL_TEXT_CLASS,
  UI_FIELD_CONTROL_HEIGHT_SM_CLASS,
  UI_FIELD_DISABLED_CLASS,
  UI_FIELD_FOCUS_CLASS,
  UI_FIELD_SURFACE_CLASS,
  UI_GLASS_ADAPTIVE_CONTROL_CLASS,
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
  UI_OPTION_ITEM_HOVER_CLASS,
} from './styleTokens';
import { useScopedTextHistoryProps } from './useScopedTextHistory';
import {
  type UiButtonProps,
  type UiCheckboxProps,
  type UiChipButtonProps,
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
export type { UiRangeTrackTone } from './primitiveInternals';

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

export const UiNavButton = forwardRef<HTMLButtonElement, UiNavButtonProps>(
  ({ className = '', active = false, ...props }, ref) => (
    <button
      ref={ref}
      className={`relative inline-flex h-14 w-full items-center gap-1.5 rounded-none border-0 px-4 text-left transition-colors ${UI_BUTTON_RESET_CLASS} ${UI_FIELD_DISABLED_CLASS} ${
        active
          ? `${UI_NAV_ITEM_ACTIVE_CLASS} ${UI_NAV_INDICATOR_END_CLASS}`
          : `${UI_GLASS_ADAPTIVE_NAV_CLASS} text-text-muted hover:text-text-dark`
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

export const UiChipButton = forwardRef<HTMLButtonElement, UiChipButtonProps>(
  ({
    className = '',
    active = false,
    selectionRole = 'toggle',
    selectionAppearance = 'default',
    ...props
  }, ref) => {
    const navigationActiveClass = selectionAppearance === 'subtle'
      ? `${UI_NAV_ITEM_ACTIVE_SUBTLE_CLASS} ${UI_NAV_INDICATOR_BOTTOM_SUBTLE_CLASS}`
      : `${UI_NAV_ITEM_ACTIVE_CLASS} ${UI_NAV_INDICATOR_BOTTOM_CLASS}`;
    const stateClass = selectionRole === 'navigation'
      ? active
        ? `border-transparent ${navigationActiveClass}`
        : 'border-transparent text-text-muted hover:bg-surface-dark hover:text-text-dark'
      : active
        ? UI_MULTISELECT_ITEM_ACTIVE_CLASS
        : `${UI_GLASS_ADAPTIVE_CONTROL_CLASS} ${UI_FIELD_SURFACE_CLASS} text-text-dark hover:bg-layer`;

    return (
      <button
        ref={ref}
        className={`relative inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-13 transition-colors ${UI_BUTTON_RESET_CLASS} ${stateClass} ${className}`}
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

/** 中性抬升三档（segment / tile / swatch）各自的尺寸与状态；颜色在玻璃内外由 `ui-glass-adaptive-*` 统一切换。 */
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

export const UiOptionButton = forwardRef<HTMLButtonElement, UiOptionButtonProps>(
  ({ className = '', active = false, variant = 'default', ...props }, ref) => {
    if (variant === 'segment' || variant === 'tile' || variant === 'swatch') {
      const neutral = UI_OPTION_NEUTRAL_VARIANT_CLASS[variant];
      return (
        <button
          ref={ref}
          className={`inline-flex items-center border transition-colors ${UI_BUTTON_RESET_CLASS} ${UI_FIELD_DISABLED_CLASS} ${neutral.layout} ${active ? neutral.active : neutral.rest} ${className}`}
          {...props}
        />
      );
    }

    const stateClass = (() => {
      if (variant === 'menu') {
        return active
          ? UI_OPTION_ITEM_ACTIVE_CLASS
          // hover 交给 UI_GLASS_ADAPTIVE_OPTION_CLASS：写成 `hover:bg-layer` 在玻璃里会赢，
          // 把半透明选项盖成一块实心灰。静息态仍然不描边不铺底。
          : `border-transparent text-text-dark ${UI_GLASS_ADAPTIVE_OPTION_CLASS}`;
      }

      if (variant === 'card') {
        return active
          ? UI_OPTION_ITEM_ACTIVE_CLASS
          : 'border-border-dark bg-surface-dark text-text-dark hover:border-text-muted hover:bg-layer';
      }

      if (variant === 'flat') {
        return active
          ? `${UI_OPTION_ITEM_ACTIVE_CLASS}`
          : `border-border-dark bg-surface-dark text-text-dark hover:bg-layer hover:border-text-muted`;
      }

      return active
        ? UI_OPTION_ITEM_ACTIVE_CLASS
        : `${UI_OPTION_ITEM_CLASS} ${UI_OPTION_ITEM_HOVER_CLASS}`;
    })();
    const adaptiveSurfaceClass = active
      ? ''
      : variant === 'menu' || variant === 'default'
        ? UI_GLASS_ADAPTIVE_OPTION_CLASS
        : UI_GLASS_ADAPTIVE_CONTROL_CLASS;

    return (
      <button
        ref={ref}
        // menu 与默认描边选项的静息态都不铺底，不能叠 adaptive-control（它会画出实底）。
        // 二者只在 hover 时通过 adaptive-option 出底；card / flat 仍保留控件表面。
        className={`inline-flex items-center rounded-lg border px-2.5 py-2 text-left transition-colors ${UI_BUTTON_RESET_CLASS} ${adaptiveSurfaceClass} ${stateClass} ${className}`}
        {...props}
      />
    );
  }
);

UiOptionButton.displayName = 'UiOptionButton';

export function UiTextArea({ className = '', textHistory, value, ...props }: UiTextAreaProps): JSX.Element {
  const historyProps = useScopedTextHistoryProps(
    resolveTextHistoryValue(value),
    textHistory,
    props
  );
  return (
    <textarea
      value={value}
      className={`w-full resize-none rounded-lg border px-3 py-2.5 text-13 leading-5 placeholder:text-text-muted ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
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
        className={`w-full resize-none rounded-lg border px-3 py-2.5 text-13 leading-5 placeholder:text-text-muted ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
        {...props}
        {...historyProps}
      />
    );
  }
);

UiTextAreaField.displayName = 'UiTextAreaField';

export const UiInput = forwardRef<HTMLInputElement, UiInputProps>(
  ({ className = '', textHistory, value, ...props }, ref) => {
    const historyProps = useScopedTextHistoryProps(
      resolveTextHistoryValue(value),
      textHistory,
      props
    );
    return (
      <input
        ref={ref}
        value={value}
        className={`w-full rounded-lg border px-3 py-2 text-13 leading-5 placeholder:text-text-muted ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
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
      [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-accent
      [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full
      [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent
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

export const UiCheckbox = forwardRef<HTMLButtonElement, UiCheckboxProps>(
  ({ className = '', checked, onCheckedChange, onClick, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
        checked
          ? `${UI_BOOLEAN_CONTROL_ACTIVE_CLASS} text-white`
          : 'border-border-dark bg-bg-dark text-transparent hover:border-text-muted'
      } ${className}`}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onCheckedChange?.(!checked);
        }
      }}
      {...props}
    >
      <Check className="h-3.5 w-3.5" />
    </button>
  )
);

UiCheckbox.displayName = 'UiCheckbox';

export const UiSwitch = forwardRef<HTMLButtonElement, UiSwitchProps>(
  ({ className = '', checked, onCheckedChange, onClick, appearance = 'pill', offLabel, onLabel, size = 'field', ...props }, ref) => {
    const handleClick: ButtonHTMLAttributes<HTMLButtonElement>['onClick'] = (event) => {
      onClick?.(event);
      if (!event.defaultPrevented) {
        onCheckedChange?.(!checked);
      }
    };

    if (appearance === 'segmented') {
      const isCompact = size === 'compact';
      const sizeClass = isCompact
        ? 'h-7 w-20 rounded-md bg-surface-dark text-xs'
        : `${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} w-28 rounded-lg bg-surface-dark text-13`;
      const thumbRadiusClass = isCompact
        ? 'rounded'
        : 'rounded-md';
      const thumbVerticalInsetClass = isCompact
        ? 'inset-y-0.5'
        : 'inset-y-1';

      return (
        <button
          ref={ref}
          type="button"
          role="switch"
          aria-checked={checked}
          className={`relative inline-grid grid-cols-2 items-stretch border border-border-dark p-1 font-medium uppercase transition-colors duration-120 hover:border-text-muted/60 ${UI_BUTTON_RESET_CLASS} ${UI_FIELD_DISABLED_CLASS} ${sizeClass} ${className}`}
          onClick={handleClick}
          {...props}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute ${thumbVerticalInsetClass} left-1 w-[calc(50%_-_0.25rem)] ${thumbRadiusClass} transition-[transform,background-color] duration-180 ${
              checked
                ? `${UI_COLOR_ACCENT_FILL_TEXT_CLASS} translate-x-full`
                : 'translate-x-0 bg-layer'
            }`}
          />
          <span
            className={`pointer-events-none relative flex min-w-0 items-center justify-center transition-colors duration-180 ${
              checked ? 'text-text-soft' : 'text-text-dark'
            }`}
          >
            {offLabel}
          </span>
          <span
            className={`pointer-events-none relative flex min-w-0 items-center justify-center transition-colors duration-180 ${
              checked ? 'text-white' : 'text-text-soft'
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
        className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
          checked
            ? UI_BOOLEAN_CONTROL_ACTIVE_CLASS
            : 'border-border-dark bg-surface-dark hover:border-text-muted/60'
        } ${UI_BUTTON_RESET_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
        onClick={handleClick}
        {...props}
      >
        <span
          className={`pointer-events-none ml-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-120 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    );
  }
);

UiSwitch.displayName = 'UiSwitch';

export function UiSelect({ className = '', children, ...props }: UiSelectProps) {
  return (
    <div className="relative">
      <select
        className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} w-full appearance-none rounded-lg border px-3 pr-8 text-13 ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
    </div>
  );
}
