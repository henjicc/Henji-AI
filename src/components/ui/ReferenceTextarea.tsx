import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  insertReferenceToken,
  normalizeReferenceTokenSpacing,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
} from '@/core/inputs/referenceTokens';
import {
  DEFAULT_PICKER_OFFSET_Y,
  PICKER_FALLBACK_ANCHOR,
  type PickerAnchor,
  renderHighlightedText,
  resolvePickerAnchor,
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
interface ReferenceTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'className' | 'onKeyDown'> {
  value: string;
  onChange: (nextValue: string) => void;
  references: ReferenceItem[];
  className?: string;
  textareaClassName?: string;
  highlightLayerClassName?: string;
  highlightContentClassName?: string;
  pickerClassName?: string;
  pickerListClassName?: string;
  pickerItemClassName?: string;
  pickerActiveItemClassName?: string;
  pickerOffsetY?: number;
  pickerAnchorScale?: number;
  submitShortcut?: SubmitShortcut;
  onSubmit?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  getReferenceToken?: (item: ReferenceItem, index: number) => string;
  renderPickerItem?: (params: RenderPickerItemParams) => ReactNode;
}
export function ReferenceTextarea({
  value,
  onChange,
  references,
  className = '',
  textareaClassName = '',
  highlightLayerClassName = '',
  highlightContentClassName = '',
  pickerClassName = '',
  pickerListClassName = '',
  pickerItemClassName = '',
  pickerActiveItemClassName = '',
  pickerOffsetY = DEFAULT_PICKER_OFFSET_Y,
  pickerAnchorScale = 1,
  submitShortcut = 'none',
  onSubmit,
  onKeyDown,
  getReferenceToken,
  renderPickerItem,
  disabled,
  onScroll,
  onFocus,
  ...textareaProps
}: ReferenceTextareaProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const [showPicker, setShowPicker] = useState(false);
  const [pickerCursor, setPickerCursor] = useState<number | null>(null);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(PICKER_FALLBACK_ANCHOR);

  const highlightedText = useMemo(() => renderHighlightedText(value), [value]);

  const closePicker = useCallback(() => {
    setShowPicker(false);
    setPickerCursor(null);
    setPickerActiveIndex(0);
  }, []);

  const syncHighlightScroll = useCallback(() => {
    if (!textareaRef.current || !highlightRef.current) {
      return;
    }

    highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
  }, []);

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

    const marker = resolveToken(selected, index);
    const cursor = pickerCursor ?? value.length;
    const { nextText, nextCursor } = insertReferenceToken(value, cursor, marker);

    onChange(nextText);
    closePicker();

    requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return;
      }

      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(nextCursor, nextCursor);
      syncHighlightScroll();
    });
  }, [closePicker, onChange, pickerCursor, references, resolveToken, syncHighlightScroll, value]);

  useEffect(() => {
    if (disabled || references.length === 0) {
      closePicker();
      return;
    }

    setPickerActiveIndex((previous) => Math.min(previous, references.length - 1));
  }, [closePicker, disabled, references.length]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as globalThis.Node)) {
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
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const selectionStart = event.currentTarget.selectionStart ?? value.length;
      const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
      const deleteDirection = event.key === 'Backspace' ? 'backward' : 'forward';
      const deleteRange = resolveReferenceAwareDeleteRange(
        value,
        selectionStart,
        selectionEnd,
        deleteDirection
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

    if (event.key === '@' && !disabled && references.length > 0) {
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

    const hasModifier = event.ctrlKey || event.metaKey;
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
    onSubmit,
    pickerActiveIndex,
    pickerAnchorScale,
    pickerOffsetY,
    references.length,
    showPicker,
    submitShortcut,
    syncHighlightScroll,
    value,
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
  const textareaMergedClassName = `relative z-10 ${textareaClassName}`.trim();
  const handleTextareaChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    const rawText = event.currentTarget.value;
    const cursor = event.currentTarget.selectionStart ?? rawText.length;
    const normalized = normalizeReferenceTokenSpacing(rawText, cursor);
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
  }, [onChange, syncHighlightScroll]);

  return (
    <div ref={rootRef} className={rootClassName}>
      <div
        ref={highlightRef}
        aria-hidden="true"
        className={`ui-scrollbar pointer-events-none absolute inset-0 z-0 overflow-y-auto overflow-x-hidden ${highlightLayerClassName}`}
        style={{ scrollbarGutter: 'stable' }}
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
        style={{ scrollbarGutter: 'stable' }}
        {...textareaProps}
      />

      {showPicker && references.length > 0 && (
        <div
          className={`nowheel absolute z-30 w-[140px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl ${pickerClassName}`}
          style={{ left: pickerAnchor.left, top: pickerAnchor.top }}
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
      )}
    </div>
  );
}
