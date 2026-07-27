import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  UI_BOOLEAN_CONTROL_ACTIVE_CLASS,
  UI_BUTTON_RESET_CLASS,
  UI_COLOR_ACCENT_FILL_TEXT_CLASS,
  UI_FIELD_CONTROL_HEIGHT_CLASS,
  UI_FIELD_CONTROL_HEIGHT_SM_CLASS,
  UI_FIELD_DISABLED_CLASS,
  UI_FIELD_FOCUS_CLASS,
  UI_FIELD_SURFACE_CLASS,
  UI_INSET_SURFACE_CLASS,
  UI_MULTISELECT_ITEM_ACTIVE_CLASS,
  UI_NAV_INDICATOR_BOTTOM_CLASS,
  UI_NAV_INDICATOR_END_CLASS,
  UI_NAV_ITEM_ACTIVE_CLASS,
  UI_OPTION_ITEM_ACTIVE_CLASS,
  UI_OPTION_ITEM_CLASS,
  UI_OPTION_ITEM_HOVER_CLASS,
  UI_PANEL_SURFACE_CLASS,
} from './styleTokens';
import {
  type ScopedTextHistoryBinding,
  useScopedTextHistoryProps,
} from './useScopedTextHistory';

type ButtonVariant = 'primary' | 'muted' | 'ghost';

type ButtonSize = 'sm' | 'md' | 'control' | 'field';

interface UiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

interface UiIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  showBorder?: boolean;
  appearance?: 'default' | 'hover-only';
  hoverVariant?: 'default' | 'danger';
}

interface UiChipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /** `navigation` 表示“正在看哪里”；默认 `toggle` 表示多选/标签开态。 */
  selectionRole?: 'toggle' | 'navigation';
}

interface UiNavButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

interface UiCheckboxProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

interface UiSwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

interface UiSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

interface UiOptionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /**
   * `menu`：静息态完全透明，只靠 hover 与选中态表达状态。
   *
   * 用于**同质选项的集合**（菜单项、模型网格、列表项）：一屏里几十个选项各自描边时，
   * 边框互相抵消、不再传递任何信息，只剩视觉重量。可点击性由 hover 反馈与排布规律表达，
   * 不需要静息态的框。孤立的单个按钮不适用，那种情况下框才真的在划定边界。
   *
   * 静息态刻意**不写 `bg-transparent`**：button 的透明背景由 preflight 保证，
   * 而写出来会和调用方补的 `bg-veil-faint`（二维网格撑格子用）在同一 CSS 属性上打架，
   * 胜负取决于 Tailwind 产物里的先后顺序而非 className 顺序，是个静默失效的坑。
   */
  variant?: 'default' | 'card' | 'flat' | 'menu';
}

interface UiInputProps extends InputHTMLAttributes<HTMLInputElement> {
  textHistory?: ScopedTextHistoryBinding;
}

interface UiTextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  textHistory?: ScopedTextHistoryBinding;
}

function resolveTextHistoryValue(value: string | number | readonly string[] | undefined): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function resolveButtonVariant(variant: ButtonVariant): string {
  if (variant === 'primary') {
    return `border border-transparent ${UI_COLOR_ACCENT_FILL_TEXT_CLASS} text-white hover:brightness-110`;
  }

  if (variant === 'ghost') {
    return 'border border-border-dark bg-surface-dark text-text-dark hover:bg-layer';
  }

  return `${UI_FIELD_SURFACE_CLASS} border border-border-dark text-text-dark hover:bg-layer`;
}

function resolveButtonSize(size: ButtonSize, variant: ButtonVariant): string {
  if (size === 'sm') {
    return 'h-8 px-3 text-xs';
  }

  if (size === 'field') {
    return `${UI_FIELD_CONTROL_HEIGHT_CLASS} min-h-[42px] px-3.5 text-sm leading-none`;
  }

  if (size === 'control') {
    return variant === 'primary'
      ? 'h-[40px] min-h-[40px] px-4 text-sm leading-none'
      : 'h-[42px] min-h-[42px] px-4 text-sm leading-none';
  }

  return 'h-10 px-3.5 text-sm';
}

export const UiButton = forwardRef<HTMLButtonElement, UiButtonProps>(
  ({ className = '', variant = 'muted', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors ${UI_BUTTON_RESET_CLASS} ${UI_FIELD_DISABLED_CLASS} ${resolveButtonVariant(variant)} ${resolveButtonSize(size, variant)} ${className}`}
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
          : 'text-text-muted hover:bg-surface-dark hover:text-text-dark'
      } ${className}`}
      {...props}
    />
  )
);

UiNavButton.displayName = 'UiNavButton';

export function UiIconButton({
  className = '',
  active = false,
  showBorder = true,
  appearance = 'default',
  hoverVariant = 'default',
  ...props
}: UiIconButtonProps) {
  const hoverOnly = appearance === 'hover-only';
  const stateClass = active
    ? (showBorder
      ? UI_MULTISELECT_ITEM_ACTIVE_CLASS
      : `border-transparent ${UI_NAV_ITEM_ACTIVE_CLASS}`)
    : (showBorder
      ? hoverVariant === 'danger'
        ? `${UI_FIELD_SURFACE_CLASS} text-text-muted hover:border-red-500/40 hover:bg-red-600/35`
        : `${UI_FIELD_SURFACE_CLASS} text-text-muted hover:bg-layer`
      : hoverOnly
        ? hoverVariant === 'danger'
          ? 'border-transparent text-text-muted hover:border-red-500/40 hover:bg-red-600/35'
          : 'border-transparent text-text-muted hover:border-border-dark hover:bg-surface-dark'
        : hoverVariant === 'danger'
          ? 'border-border-dark bg-surface-dark text-text-muted hover:border-red-500/40 hover:bg-red-600/35'
          : 'border-border-dark bg-surface-dark text-text-muted');

  return (
    <button
      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-colors ${UI_BUTTON_RESET_CLASS} ${stateClass} ${className}`}
      {...props}
    />
  );
}

export const UiChipButton = forwardRef<HTMLButtonElement, UiChipButtonProps>(
  ({ className = '', active = false, selectionRole = 'toggle', ...props }, ref) => {
    const stateClass = selectionRole === 'navigation'
      ? active
        ? `border-transparent ${UI_NAV_ITEM_ACTIVE_CLASS} ${UI_NAV_INDICATOR_BOTTOM_CLASS}`
        : 'border-transparent text-text-muted hover:bg-surface-dark hover:text-text-dark'
      : active
        ? UI_MULTISELECT_ITEM_ACTIVE_CLASS
        : `${UI_FIELD_SURFACE_CLASS} text-text-dark hover:bg-layer`;

    return (
      <button
        ref={ref}
        className={`relative inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm transition-colors ${UI_BUTTON_RESET_CLASS} ${stateClass} ${className}`}
        {...props}
      />
    );
  }
);

UiChipButton.displayName = 'UiChipButton';

type UiPanelVariant = 'panel' | 'inset' | 'bare';

interface UiPanelProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * 表面变体，用来避免"卡片套卡片"：
   * - `panel`（默认）：完整浮层表面（边框 + 背景 + 阴影），用于最外层独立面板/弹窗
   * - `inset`：内嵌分区，仅用更暗的背景做层次，无边框无阴影，用于已在某个 panel 内部再分组
   * - `bare`：纯语义分组容器，无边框无背景无阴影，只保留圆角，靠留白区分层次
   *
   * 铁律：同一层视觉深度只画一次边框/背景。进入一个已经有边框的容器后，
   * 内部分组请用 `inset` 或 `bare`，不要再套一层 `panel`，也不要手写 `border + bg-*` 的 div。
   */
  variant?: UiPanelVariant;
}

// 圆角跟随层级：外层面板 rounded-xl，内嵌元素 rounded-lg。内层圆角不得大于外层。
function resolveUiPanelSurface(variant: UiPanelVariant): string {
  if (variant === 'inset') {
    return `rounded-lg ${UI_INSET_SURFACE_CLASS}`;
  }
  if (variant === 'bare') {
    return 'rounded-lg';
  }
  return `rounded-xl ${UI_PANEL_SURFACE_CLASS}`;
}

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

export const UiOptionButton = forwardRef<HTMLButtonElement, UiOptionButtonProps>(
  ({ className = '', active = false, variant = 'default', ...props }, ref) => {
    const stateClass = (() => {
      if (variant === 'menu') {
        return active
          ? UI_OPTION_ITEM_ACTIVE_CLASS
          : 'border-transparent text-text-dark hover:bg-layer';
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

    return (
      <button
        ref={ref}
        className={`inline-flex items-center rounded-lg border px-2.5 py-2 text-left transition-colors ${UI_BUTTON_RESET_CLASS} ${stateClass} ${className}`}
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
      className={`w-full resize-none rounded-lg border px-3 py-2.5 text-sm placeholder:text-text-muted ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
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
        className={`w-full resize-none rounded-lg border px-3 py-2.5 text-sm placeholder:text-text-muted ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
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
        className={`w-full rounded-lg border px-3 py-2 text-sm placeholder:text-text-muted ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
        {...props}
        {...historyProps}
      />
    );
  }
);

UiInput.displayName = 'UiInput';

/** 轨道底色。`hue` 铺满色相光谱，供色相选择使用。 */
export type UiRangeTrackTone = 'neutral' | 'hue';

interface UiRangeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  trackTone?: UiRangeTrackTone;
}

// 两种轨道底色必须互斥：都落在 background 上，叠着写的话胜负取决于 Tailwind
// 产物顺序而非 className 顺序，会静默失效。
const UI_RANGE_TRACK_TONE_CLASS: Record<UiRangeTrackTone, string> = {
  neutral: '[&::-webkit-slider-runnable-track]:bg-layer/80 [&::-moz-range-track]:bg-layer/80',
  hue: 'ui-range-track-hue',
};

export const UiRangeInput = forwardRef<HTMLInputElement, UiRangeInputProps>(
  ({ className = '', trackTone = 'neutral', ...props }, ref) => (
    <input
      ref={ref}
      type="range"
      className={`h-5 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none
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
      className={`h-9 w-10 cursor-pointer rounded-md border bg-transparent p-1 ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
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
      className={`inline-flex h-5 w-5 items-center justify-center rounded border transition-colors ${
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
  ({ className = '', checked, onCheckedChange, onClick, ...props }, ref) => (
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
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onCheckedChange?.(!checked);
        }
      }}
      {...props}
    >
      <span
        className={`pointer-events-none ml-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-150 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
);

UiSwitch.displayName = 'UiSwitch';

export function UiSelect({ className = '', children, ...props }: UiSelectProps) {
  return (
    <div className="relative">
      <select
        className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} w-full appearance-none rounded-lg border px-3 pr-8 text-sm ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
    </div>
  );
}
