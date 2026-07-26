import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

const dialogStack: HTMLElement[] = [];

interface DialogFocusTrapOptions {
  active: boolean;
  dialogRef: RefObject<HTMLElement>;
  onClose: () => void;
}

function removeFromDialogStack(dialog: HTMLElement): boolean {
  const index = dialogStack.lastIndexOf(dialog);
  if (index < 0) {
    return false;
  }
  const wasTopmost = index === dialogStack.length - 1;
  dialogStack.splice(index, 1);
  return wasTopmost;
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

/**
 * 为模态弹窗提供共享的顶层栈、Esc 关闭、Tab 焦点循环和焦点还原。
 *
 * `UiModal` 与独立实现的 `AlertDialog` 必须共用同一个栈，否则二级确认框
 * 叠在设置弹窗上时，一次 Esc 会同时触发两套关闭逻辑。
 */
export function useDialogFocusTrap({
  active,
  dialogRef,
  onClose,
}: DialogFocusTrapOptions): void {
  const onCloseRef = useRef(onClose);
  const wasActiveRef = useRef(false);
  const focusBeforeActivationRef = useRef<HTMLElement | null>(null);

  if (active && !wasActiveRef.current) {
    focusBeforeActivationRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }
  wasActiveRef.current = active;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const previouslyFocused = focusBeforeActivationRef.current;
    dialogStack.push(dialog);

    const focusFrame = window.requestAnimationFrame(() => {
      if (dialogStack[dialogStack.length - 1] === dialog) {
        dialog.focus({ preventScroll: true });
      }
    });

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (dialogStack[dialogStack.length - 1] !== dialog) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === dialog || activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      const wasTopmost = removeFromDialogStack(dialog);
      if (wasTopmost && previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
      focusBeforeActivationRef.current = null;
    };
  }, [active, dialogRef]);
}
