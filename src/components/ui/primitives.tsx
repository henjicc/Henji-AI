import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from './motion';
import {
  UI_BUTTON_RESET_CLASS,
  UI_COLOR_ACCENT_BG_CLASS,
  UI_COLOR_ACCENT_SOFT_BG_CLASS,
  UI_COLOR_ACCENT_SOFT_BG_WEAK_CLASS,
  UI_COLOR_ACCENT_SOFT_BORDER_CLASS,
  UI_COLOR_ACCENT_TEXT_CLASS,
  UI_FIELD_DISABLED_CLASS,
  UI_FIELD_FOCUS_CLASS,
  UI_FIELD_SURFACE_CLASS,
  UI_OPTION_ITEM_ACTIVE_CLASS,
  UI_OPTION_ITEM_CLASS,
  UI_OPTION_ITEM_HOVER_CLASS,
  UI_PANEL_SURFACE_CLASS,
} from './styleTokens';
import { useDialogTransition } from './useDialogTransition';

type ButtonVariant = 'primary' | 'muted' | 'ghost';

type ButtonSize = 'sm' | 'md' | 'control';

interface UiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

interface UiIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  showBorder?: boolean;
  appearance?: 'default' | 'hover-only';
}

interface UiChipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

interface UiNavButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

interface UiCheckboxProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

interface UiSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

interface UiOptionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  variant?: 'default' | 'card' | 'flat';
}

interface UiModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  widthClassName?: string;
}

function resolveButtonVariant(variant: ButtonVariant): string {
  if (variant === 'primary') {
    return `border border-transparent ${UI_COLOR_ACCENT_BG_CLASS} text-white hover:brightness-110`;
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
      className={`relative inline-flex h-14 w-full items-center gap-1.5 rounded-none border-0 bg-transparent px-4 text-left transition-colors ${UI_BUTTON_RESET_CLASS} ${UI_FIELD_DISABLED_CLASS} ${
        active
          ? '!bg-layer text-accent after:absolute after:right-0 after:top-0 after:h-full after:w-[3px] after:bg-accent after:content-[\'\']'
          : 'text-zinc-400 hover:bg-surface-dark hover:text-zinc-100'
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
  ...props
}: UiIconButtonProps) {
  const hoverOnly = appearance === 'hover-only';
  const shellClass = showBorder
    ? `${UI_FIELD_SURFACE_CLASS} border`
    : hoverOnly
      ? 'border border-transparent bg-transparent'
      : 'border border-border-dark bg-surface-dark';

  const stateClass = active
    ? (showBorder
      ? `${UI_COLOR_ACCENT_SOFT_BORDER_CLASS} ${UI_COLOR_ACCENT_SOFT_BG_CLASS} text-text-dark`
      : `${UI_COLOR_ACCENT_TEXT_CLASS} ${UI_COLOR_ACCENT_SOFT_BG_WEAK_CLASS}`)
    : (showBorder
      ? 'text-text-muted hover:bg-layer'
      : hoverOnly
        ? 'text-text-muted hover:border-border-dark hover:bg-surface-dark'
        : 'text-text-muted');

  return (
    <button
      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${UI_BUTTON_RESET_CLASS} ${shellClass} ${stateClass} ${className}`}
      {...props}
    />
  );
}

export const UiChipButton = forwardRef<HTMLButtonElement, UiChipButtonProps>(
  ({ className = '', active = false, ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm transition-colors ${UI_BUTTON_RESET_CLASS} ${UI_FIELD_SURFACE_CLASS} ${active ? 'border-brand-500 bg-layer text-accent' : 'text-text-dark hover:bg-layer'} ${className}`}
      {...props}
    />
  )
);

UiChipButton.displayName = 'UiChipButton';

export const UiPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`rounded-xl ${UI_PANEL_SURFACE_CLASS} ${className}`}
      {...props}
    />
  )
);

UiPanel.displayName = 'UiPanel';

export const UiOptionButton = forwardRef<HTMLButtonElement, UiOptionButtonProps>(
  ({ className = '', active = false, variant = 'default', ...props }, ref) => {
    const stateClass = (() => {
      if (variant === 'card') {
        return active
          ? 'border-accent bg-brand-600 text-white'
          : 'border-border-dark bg-surface-dark text-text-dark hover:border-text-muted hover:bg-layer';
      }

      if (variant === 'flat') {
        return active
          ? `${UI_OPTION_ITEM_ACTIVE_CLASS}`
          : `border-border-dark bg-surface-dark text-text-dark hover:bg-layer hover:border-text-muted`;
      }

      return active
        ? `${UI_OPTION_ITEM_CLASS} ${UI_OPTION_ITEM_ACTIVE_CLASS}`
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

export function UiTextArea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full resize-none rounded-lg border px-3 py-2.5 text-sm placeholder:text-zinc-400 ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
      {...props}
    />
  );
}

export const UiTextAreaField = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = '', ...props }, ref) => (
    <textarea
      ref={ref}
      className={`w-full resize-none rounded-lg border px-3 py-2.5 text-sm placeholder:text-zinc-400 ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
      {...props}
    />
  )
);

UiTextAreaField.displayName = 'UiTextAreaField';

export const UiInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={`w-full rounded-lg border px-3 py-2 text-sm placeholder:text-zinc-400 ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
      {...props}
    />
  )
);

UiInput.displayName = 'UiInput';

export const UiRangeInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      type="range"
      className={`h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-accent ${className}`}
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
          ? 'border-accent bg-brand-600 text-accent'
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

export function UiSelect({ className = '', children, ...props }: UiSelectProps) {
  return (
    <div className="relative">
      <select
        className={`h-[38px] w-full appearance-none rounded-lg border px-3 pr-8 text-sm ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_FIELD_DISABLED_CLASS} ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
    </div>
  );
}

export function UiModal({
  isOpen,
  title,
  onClose,
  children,
  footer,
  widthClassName = 'w-[460px]',
}: UiModalProps) {
  const { shouldRender, isVisible } = useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS);

  if (!shouldRender) {
    return null;
  }

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-50 flex items-center justify-center`}>
      <div
        className={`absolute inset-0 bg-black/55 transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <UiPanel
        className={`relative transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'} ${widthClassName}`}
      >
        <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.1)] px-4 py-3">
          <h2 className="text-sm font-medium text-text-dark">{title}</h2>
          <UiIconButton className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </UiIconButton>
        </div>

        <div className="px-4 py-4">{children}</div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-[rgba(255,255,255,0.1)] px-4 py-3">
            {footer}
          </div>
        )}
      </UiPanel>
    </div>
  );
}
