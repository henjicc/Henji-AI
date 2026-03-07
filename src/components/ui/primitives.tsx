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
import { useDialogTransition } from './useDialogTransition';

type ButtonVariant = 'primary' | 'muted' | 'ghost';

type ButtonSize = 'sm' | 'md';

interface UiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

interface UiIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

interface UiChipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

interface UiCheckboxProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

interface UiSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

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
    return 'bg-accent text-white hover:bg-accent/85';
  }

  if (variant === 'ghost') {
    return 'bg-transparent text-text-dark hover:bg-bg-dark/70';
  }

  return 'bg-bg-dark/80 text-text-dark hover:bg-bg-dark';
}

function resolveButtonSize(size: ButtonSize): string {
  return size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-3.5 text-sm';
}

export function UiButton({
  className = '',
  variant = 'muted',
  size = 'md',
  ...props
}: UiButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${resolveButtonVariant(variant)} ${resolveButtonSize(size)} ${className}`}
      {...props}
    />
  );
}

export function UiIconButton({ className = '', active = false, ...props }: UiIconButtonProps) {
  return (
    <button
      className={`inline-flex h-10 w-10 items-center justify-center border ui-field transition-colors ${active ? 'border-accent/45 bg-accent/18 text-text-dark' : 'text-text-muted hover:bg-bg-dark'} ${className}`}
      {...props}
    />
  );
}

export const UiChipButton = forwardRef<HTMLButtonElement, UiChipButtonProps>(
  ({ className = '', active = false, ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex h-10 items-center gap-2 border ui-field px-3 text-sm transition-colors ${active ? 'border-accent/45 bg-accent/15 text-text-dark' : 'text-text-dark hover:bg-bg-dark'} ${className}`}
      {...props}
    />
  )
);

UiChipButton.displayName = 'UiChipButton';

export function UiPanel({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`border ui-panel ${className}`}
      {...props}
    />
  );
}

export function UiTextArea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full resize-none border ui-field px-3 py-2.5 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/70 focus:border-accent ${className}`}
      {...props}
    />
  );
}

export const UiTextAreaField = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = '', ...props }, ref) => (
    <textarea
      ref={ref}
      className={`w-full resize-none border ui-field px-3 py-2.5 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/70 focus:border-accent ${className}`}
      {...props}
    />
  )
);

UiTextAreaField.displayName = 'UiTextAreaField';

export const UiInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={`w-full border ui-field px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/70 focus:border-accent ${className}`}
      {...props}
    />
  )
);

UiInput.displayName = 'UiInput';

export const UiCheckbox = forwardRef<HTMLButtonElement, UiCheckboxProps>(
  ({ className = '', checked, onCheckedChange, onClick, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`inline-flex h-5 w-5 items-center justify-center rounded border transition-colors ${
        checked
          ? 'border-accent/60 bg-accent/20 text-accent'
          : 'border-[rgba(255,255,255,0.2)] bg-bg-dark/60 text-transparent hover:border-[rgba(255,255,255,0.32)]'
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
        className={`h-8 w-full appearance-none rounded-lg border border-[rgba(255,255,255,0.14)] bg-bg-dark/70 px-2 pr-7 text-xs text-text-dark outline-none transition-colors focus:border-accent ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
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
