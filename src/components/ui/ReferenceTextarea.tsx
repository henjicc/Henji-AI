import {
  type ChangeEvent,
  forwardRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  insertReferenceToken,
  normalizeReferenceTokenSpacing,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
} from '@/core/inputs/referenceTokens';
import {
  captureTextareaView,
  DEFAULT_PICKER_OFFSET_Y,
  PICKER_FALLBACK_ANCHOR,
  type PickerAnchor,
  renderHighlightedText,
  resolvePickerAnchor,
  restoreTextareaView,
} from './referenceTextareaUtils';
import { UiOptionButton, UiTextAreaField } from './primitives';
export interface ReferenceItem {
  id: string;
  label: string;
  thumbnailSrc?: string;
}
type SubmitShortcut = 'enter' | 'mod-enter' | 'none';
interface RenderPickerItemParams {
  item: ReferenceItem;
  index: number;
  active: boolean;
}
export interface ReferenceTextareaHandle {
  focus: () => void;
  replaceValueWithUndo: (nextValue: string) => boolean;
}
interface ReferenceTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'className' | 'onKeyDown'> {
  value: string;
  onChange: (nextValue: string) => void;
  undoTriggerValue?: string | null;
  undoReplacementValue?: string | null;
  onUndoReplacement?: () => void;
  redoTriggerValue?: string | null;
  redoReplacementValue?: string | null;
  onRedoReplacement?: () => void;
  references: ReferenceItem[];
  className?: string;
  textareaClassName?: string;
  highlightLayerClassName?: string;
  highlightLayerStyle?: CSSProperties;
  highlightContentClassName?: string;
  pickerClassName?: string;
  pickerListClassName?: string;
  pickerItemClassName?: string;
  pickerActiveItemClassName?: string;
  pickerOffsetY?: number;
  pickerAnchorScale?: number;
  pickerPortal?: boolean;
  triggerKey?: string;
  tokenPrefix?: string;
  literalTokens?: string[];
  renderHighlightedValue?: (value: string) => ReactNode;
  submitShortcut?: SubmitShortcut;
  onSubmit?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  getReferenceToken?: (item: ReferenceItem, index: number) => string;
  renderPickerItem?: (params: RenderPickerItemParams) => ReactNode;
}
export const ReferenceTextarea = forwardRef<ReferenceTextareaHandle, ReferenceTextareaProps>(function ReferenceTextarea({
  value,
  onChange,
  undoTriggerValue = null,
  undoReplacementValue = null,
  onUndoReplacement,
  redoTriggerValue = null,
  redoReplacementValue = null,
  onRedoReplacement,
  references,
  className = '',
  textareaClassName = '',
  highlightLayerClassName = '',
  highlightLayerStyle,
  highlightContentClassName = '',
  pickerClassName = '',
  pickerListClassName = '',
  pickerItemClassName = '',
  pickerActiveItemClassName = '',
  pickerOffsetY = DEFAULT_PICKER_OFFSET_Y,
  pickerAnchorScale = 1,
  pickerPortal = false,
  triggerKey = '@',
  tokenPrefix = '@',
  literalTokens,
  renderHighlightedValue,
  submitShortcut = 'none',
  onSubmit,
  onKeyDown,
  getReferenceToken,
  renderPickerItem,
  disabled,
  onScroll,
  onFocus,
  style,
  ...textareaProps
}, ref): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const [showPicker, setShowPicker] = useState(false);
  const [pickerCursor, setPickerCursor] = useState<number | null>(null);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(PICKER_FALLBACK_ANCHOR);

  const highlightedText = useMemo(
    () => renderHighlightedValue ? renderHighlightedValue(value) : renderHighlightedText(value),
    [renderHighlightedValue, value]
  );
  const referenceLabels = useMemo(
    () => references.map((item) => item.label),
    [references]
  );

  const closePicker = useCallback(() => {
    setShowPicker(false);
    setPickerCursor(null);
    setPickerActiveIndex(0);
  }, []);

  const syncHighlightScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const highlight = highlightRef.current;
    if (!textarea || !highlight) {
      return;
    }

    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  }, []);

  const replaceValueWithUndo = useCallback((nextValue: string): boolean => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return false;
    }

    textarea.focus();
    textarea.setSelectionRange(0, textarea.value.length);

    const commandSupported = typeof document !== 'undefined' && typeof document.execCommand === 'function';
    if (!commandSupported) {
      onChange(nextValue);
      return false;
    }

    const executed = document.execCommand('insertText', false, nextValue);
    if (!executed) {
      onChange(nextValue);
    }
    requestAnimationFrame(syncHighlightScroll);
    return executed;
  }, [onChange, syncHighlightScroll]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus();
    },
    replaceValueWithUndo,
  }), [replaceValueWithUndo]);

  const resolveToken = useCallback((item: ReferenceItem, index: number): string => {
    if (getReferenceToken) {
      return getReferenceToken(item, index);
    }
    return `@${item.label}`;
  }, [getReferenceToken]);

  const insertReference = useCallback((index: number) => {
    const selected = references[index];
    if (!selected) {
      closePicker();
      return;
    }

    const textareaView = textareaRef.current
      ? captureTextareaView(textareaRef.current)
      : null;
    const marker = resolveToken(selected, index);
    const cursor = pickerCursor ?? value.length;
    const inserted = insertReferenceToken(value, cursor, marker);
    const normalized = normalizeReferenceTokenSpacing(
      inserted.nextText,
      inserted.nextCursor,
      referenceLabels,
      tokenPrefix,
      literalTokens
    );

    onChange(normalized.nextText);
    closePicker();

    requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return;
      }

      if (textareaView) {
        restoreTextareaView(textareaRef.current, normalized.nextCursor, textareaView);
      } else {
        textareaRef.current.focus({ preventScroll: true });
        textareaRef.current.setSelectionRange(normalized.nextCursor, normalized.nextCursor);
      }
      syncHighlightScroll();
    });
  }, [closePicker, literalTokens, onChange, pickerCursor, referenceLabels, references, resolveToken, syncHighlightScroll, tokenPrefix, value]);

  useEffect(() => {
    if (disabled || references.length === 0) {
      closePicker();
      return;
    }

    setPickerActiveIndex((previous) => Math.min(previous, references.length - 1));
  }, [closePicker, disabled, references.length]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as globalThis.Node
      if (rootRef.current?.contains(target) || pickerRef.current?.contains(target)) {
        return;
      }
      closePicker();
    };

    document.addEventListener('mousedown', handleOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
    };
  }, [closePicker]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const hasModifier = event.ctrlKey || event.metaKey;
    const isUndoShortcut = hasModifier && !event.shiftKey && !event.altKey && (event.key === 'z' || event.key === 'Z');
    const isRedoShortcut = hasModifier && !event.altKey && (
      event.key === 'y'
      || event.key === 'Y'
      || (event.shiftKey && (event.key === 'z' || event.key === 'Z'))
    );

    if (isUndoShortcut && undoTriggerValue !== null && undoReplacementValue !== null && value === undoTriggerValue && value === textareaRef.current?.value) {
      event.preventDefault();
      onChange(undoReplacementValue);
      onUndoReplacement?.();

      requestAnimationFrame(() => {
        if (!textareaRef.current) {
          return;
        }
        textareaRef.current.setSelectionRange(undoReplacementValue.length, undoReplacementValue.length);
        syncHighlightScroll();
      });
      return;
    }

    if (isRedoShortcut && redoTriggerValue !== null && redoReplacementValue !== null && value === redoTriggerValue && value === textareaRef.current?.value) {
      event.preventDefault();
      onChange(redoReplacementValue);
      onRedoReplacement?.();

      requestAnimationFrame(() => {
        if (!textareaRef.current) {
          return;
        }
        textareaRef.current.setSelectionRange(redoReplacementValue.length, redoReplacementValue.length);
        syncHighlightScroll();
      });
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      const selectionStart = event.currentTarget.selectionStart ?? value.length;
      const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
      const deleteDirection = event.key === 'Backspace' ? 'backward' : 'forward';
      const deleteRange = resolveReferenceAwareDeleteRange(
        value,
        selectionStart,
        selectionEnd,
        deleteDirection,
        referenceLabels,
        tokenPrefix,
        literalTokens
      );

      if (deleteRange) {
        event.preventDefault();
        const { nextText, nextCursor } = removeTextRange(value, deleteRange);
        onChange(nextText);

        requestAnimationFrame(() => {
          if (!textareaRef.current) {
            return;
          }

          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(nextCursor, nextCursor);
          syncHighlightScroll();
        });
        return;
      }
    }

    if (showPicker && references.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPickerActiveIndex((previous) => (previous + 1) % references.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPickerActiveIndex((previous) =>
          previous === 0 ? references.length - 1 : previous - 1
        );
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        insertReference(pickerActiveIndex);
        return;
      }
    }

    if (event.key === triggerKey && !disabled && references.length > 0) {
      event.preventDefault();
      const cursor = event.currentTarget.selectionStart ?? value.length;
      setPickerAnchor(resolvePickerAnchor(rootRef.current, event.currentTarget, cursor, pickerOffsetY, pickerAnchorScale));
      setPickerCursor(cursor);
      setPickerActiveIndex(0);
      setShowPicker(true);
      return;
    }

    if (event.key === 'Escape' && showPicker) {
      event.preventDefault();
      closePicker();
      return;
    }

    onKeyDown?.(event);
    if (event.defaultPrevented || !onSubmit) {
      return;
    }

    if (
      submitShortcut === 'enter'
      && event.key === 'Enter'
      && !hasModifier
      && !event.shiftKey
      && !event.altKey
    ) {
      event.preventDefault();
      onSubmit();
      return;
    }

    if (submitShortcut === 'mod-enter' && event.key === 'Enter' && hasModifier) {
      event.preventDefault();
      onSubmit();
    }
  }, [
    closePicker,
    disabled,
    insertReference,
    onChange,
    onKeyDown,
    onRedoReplacement,
    onUndoReplacement,
    onSubmit,
    pickerActiveIndex,
    pickerAnchorScale,
    pickerOffsetY,
    redoTriggerValue,
    redoReplacementValue,
    references.length,
    referenceLabels,
    tokenPrefix,
    triggerKey,
    literalTokens,
    showPicker,
    submitShortcut,
    syncHighlightScroll,
    value,
    undoTriggerValue,
    undoReplacementValue,
  ]);

  const resolveDefaultPickerItem = (item: ReferenceItem, index: number): ReactNode => {
    if (item.thumbnailSrc) {
      return (
        <>
          <img src={item.thumbnailSrc} alt={item.label} className="h-8 w-8 rounded object-cover" draggable={false} />
          <span>{item.label}</span>
        </>
      );
    }
    return <><span className="inline-flex h-8 w-8 items-center justify-center rounded bg-bg-dark text-xs text-text-muted">{index + 1}</span><span>{item.label}</span></>;
  };

  const rootClassName = `relative isolate ${className}`.trim();
  const textareaMergedClassName = `relative z-10 block ${textareaClassName}`.trim();
  const handleTextareaChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    const rawText = event.currentTarget.value;
    const cursor = event.currentTarget.selectionStart ?? rawText.length;
    const normalized = normalizeReferenceTokenSpacing(rawText, cursor, referenceLabels, tokenPrefix, literalTokens);
    onChange(normalized.nextText);

    if (!normalized.changed) {
      return;
    }

    requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return;
      }

      textareaRef.current.setSelectionRange(normalized.nextCursor, normalized.nextCursor);
      syncHighlightScroll();
    });
  }, [literalTokens, onChange, referenceLabels, syncHighlightScroll, tokenPrefix]);

  const pickerNode = showPicker && references.length > 0 ? (
    <div
      ref={pickerRef}
      className={`nowheel ${pickerPortal ? 'fixed z-[1000]' : 'absolute z-30'} w-[140px] overflow-hidden rounded-xl border border-border-dark bg-surface-dark shadow-xl ${pickerClassName}`}
      style={{
        left: pickerPortal
          ? (rootRef.current?.getBoundingClientRect().left ?? 0) + pickerAnchor.left
          : pickerAnchor.left,
        top: pickerPortal
          ? (rootRef.current?.getBoundingClientRect().top ?? 0) + pickerAnchor.top
          : pickerAnchor.top,
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onWheelCapture={(event) => event.stopPropagation()}
    >
      <div
      className={`ui-scrollbar nowheel max-h-[200px] overflow-y-auto ${pickerListClassName}`}
        onWheelCapture={(event) => event.stopPropagation()}
      >
        {references.map((item, index) => {
          const active = pickerActiveIndex === index;
          return (
            <UiOptionButton
              key={item.id}
              type="button"
              active={active}
              onMouseDown={(event) => {
                // 候选按钮不能抢走 textarea 焦点，否则受控 value 更新后重新 focus
                // 会让 Chromium 按临时位于文本末尾的 selection 自动滚动。
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                insertReference(index);
              }}
              onMouseEnter={() => setPickerActiveIndex(index)}
              className={`w-full rounded-none border-x-0 border-b-0 items-center gap-2 px-2 py-2 text-left text-sm ${pickerItemClassName} ${active ? pickerActiveItemClassName : ''}`}
            >
              {renderPickerItem
                ? renderPickerItem({ item, index, active })
                : resolveDefaultPickerItem(item, index)}
            </UiOptionButton>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={rootClassName}>
      <div
        ref={highlightRef}
        aria-hidden="true"
        className={`ui-scrollbar pointer-events-none absolute inset-0 z-0 overflow-y-auto overflow-x-hidden ${highlightLayerClassName}`}
        style={{ scrollbarGutter: 'stable', ...highlightLayerStyle }}
      >
        <div className={`min-h-full whitespace-pre-wrap break-words ${highlightContentClassName}`}>
          {highlightedText}
        </div>
      </div>

      <UiTextAreaField
        ref={textareaRef}
        value={value}
        onChange={handleTextareaChange}
        onKeyDown={handleKeyDown}
        onScroll={(event) => {
          syncHighlightScroll();
          onScroll?.(event);
        }}
        onFocus={(event) => {
          syncHighlightScroll();
          onFocus?.(event);
        }}
        disabled={disabled}
        className={textareaMergedClassName}
        style={{ scrollbarGutter: 'stable', ...style }}
        {...textareaProps}
      />

      {pickerPortal && pickerNode ? createPortal(pickerNode, document.body) : pickerNode}
    </div>
  );
});

ReferenceTextarea.displayName = 'ReferenceTextarea';
