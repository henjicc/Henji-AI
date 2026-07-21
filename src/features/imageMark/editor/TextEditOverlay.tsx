import { useRef, type RefObject } from 'react';
import { UiTextAreaField } from '@/components/ui';
import { MARK_FONT_FAMILY, TEXT_LINE_HEIGHT, estimateTextWidth } from '../domain/metrics';
import type { TextEditorState } from './shared';

interface TextEditOverlayProps {
  state: TextEditorState;
  /** 文本锚点在宿主容器中的位置(显示像素) */
  position: { x: number; y: number };
  /** 显示像素 / 图片像素 */
  scale: number;
  textInputRef: RefObject<HTMLTextAreaElement>;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/**
 * 原位文字输入:直接在最终渲染位置以最终字号/颜色编辑,无对话框。
 * 标注标签:Enter 确认(Shift+Enter 换行);独立文字:Ctrl+Enter 确认;
 * 失焦即确认,Esc 取消。
 */
export function TextEditOverlay({
  state,
  position,
  scale,
  textInputRef,
  onChange,
  onCommit,
  onCancel,
}: TextEditOverlayProps): JSX.Element {
  const isLabel = state.kind === 'label';
  const settledRef = useRef(false);

  const displayFontSize = Math.max(10, state.fontSize * scale);
  const lines = state.value === '' ? [''] : state.value.split('\n');
  // 空内容也保留一个明显的输入框,方便定位与后续缩放
  const contentWidth = Math.max(
    displayFontSize * 4,
    ...lines.map((line) => estimateTextWidth(line, displayFontSize))
  );
  const contentHeight = Math.max(1, lines.length) * displayFontSize * TEXT_LINE_HEIGHT;

  const settle = (action: () => void): void => {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    action();
  };

  return (
    <UiTextAreaField
      ref={textInputRef}
      value={state.value}
      placeholder={isLabel ? '输入文字' : ''}
      spellCheck={false}
      wrap="off"
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => settle(onCommit)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          settle(onCancel);
          return;
        }
        if (isLabel && event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          settle(onCommit);
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          settle(onCommit);
        }
      }}
      rows={1}
      className="absolute z-20 !min-h-0 resize-none overflow-hidden whitespace-pre !rounded-sm !border-0 !bg-transparent !p-0 font-semibold caret-accent outline outline-2 outline-accent/90 focus:!ring-0"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${Math.ceil(contentWidth + displayFontSize * 0.6)}px`,
        height: `${Math.ceil(contentHeight)}px`,
        fontSize: `${displayFontSize}px`,
        lineHeight: TEXT_LINE_HEIGHT,
        fontFamily: MARK_FONT_FAMILY,
        color: state.color,
        textShadow: '0 1px 2px rgba(0, 0, 0, 0.55)',
      }}
    />
  );
}
