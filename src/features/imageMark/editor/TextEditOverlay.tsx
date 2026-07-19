import type { RefObject } from 'react';
import { UiButton, UiTextAreaField } from '@/components/ui';
import type { TextEditorState } from './shared';

interface TextEditOverlayProps {
  state: TextEditorState;
  position: { x: number; y: number };
  textInputRef: RefObject<HTMLTextAreaElement>;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/**
 * 文字/标签统一输入浮层。
 * 文字模式:Ctrl+Enter 确认,支持多行;
 * 标签模式:Enter 直接确认(Shift+Enter 换行),满足"框选完立刻输入"的连贯操作。
 */
export function TextEditOverlay({
  state,
  position,
  textInputRef,
  onChange,
  onCommit,
  onCancel,
}: TextEditOverlayProps): JSX.Element {
  const isLabel = state.kind === 'label';
  return (
    <div
      className="absolute z-20 flex flex-col gap-2 rounded-md border border-[rgba(255,255,255,0.2)] bg-black/75 p-2 backdrop-blur-sm"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(0, -100%)',
        minWidth: '180px',
        maxWidth: '300px',
      }}
    >
      <UiTextAreaField
        ref={textInputRef}
        value={state.value}
        placeholder={isLabel ? '输入标注文字,Enter 确认' : ''}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (isLabel && event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onCommit();
            return;
          }
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            onCommit();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        rows={isLabel ? 1 : 3}
        className="w-full rounded border border-[rgba(255,255,255,0.18)] bg-bg-dark/90 px-2 py-1.5 text-sm text-text-dark outline-none focus:border-accent"
      />
      <div className="flex items-center justify-end gap-2">
        <UiButton type="button" variant="ghost" size="sm" onClick={onCancel}>
          取消
        </UiButton>
        <UiButton type="button" variant="primary" size="sm" onClick={onCommit}>
          确认
        </UiButton>
      </div>
    </div>
  );
}
