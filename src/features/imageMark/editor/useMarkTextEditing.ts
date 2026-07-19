import { useCallback, useState, type MutableRefObject } from 'react';
import { createMarkId } from '../domain/codec';
import { resolveLabelPlacement } from '../domain/metrics';
import { isLabeledMark, type ImageMarkDoc, type LabeledMark, type MarkItem } from '../domain/types';
import type { TextEditorState } from './shared';

export interface UseMarkTextEditingParams {
  docRef: MutableRefObject<ImageMarkDoc>;
  commitItems: (items: MarkItem[], recordHistory?: boolean) => void;
  setSelectedId: (id: string | null) => void;
  imageWidth: number;
  imageHeight: number;
  textInputRef: MutableRefObject<HTMLTextAreaElement | null>;
  /** 新建文字项使用的样式 */
  textColor: string;
  fontSize: number;
  labelFontSize: number;
}

/** 文字项与图形旁标签的统一输入编辑 */
export function useMarkTextEditing({
  docRef,
  commitItems,
  setSelectedId,
  imageWidth,
  imageHeight,
  textInputRef,
  textColor,
  fontSize,
  labelFontSize,
}: UseMarkTextEditingParams) {
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);

  const focusTextInput = useCallback(() => {
    requestAnimationFrame(() => {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    });
  }, [textInputRef]);

  /** 在图形旁打开标签输入(新建完成或双击既有图形) */
  const openLabelEditor = useCallback((item: LabeledMark) => {
    const placement = resolveLabelPlacement(
      { ...item, label: item.label ?? '标' },
      imageWidth,
      imageHeight
    );
    setTextEditor({
      kind: 'label',
      itemId: item.id,
      x: placement.x,
      y: placement.y,
      value: item.label ?? '',
      fontSize: item.labelFontSize ?? labelFontSize,
      color: item.stroke,
    });
    setSelectedId(item.id);
    focusTextInput();
  }, [focusTextInput, imageHeight, imageWidth, labelFontSize, setSelectedId]);

  const startTextEditing = useCallback((item: MarkItem | null, fallbackPoint?: { x: number; y: number }) => {
    if (item && item.type === 'text') {
      setTextEditor({
        kind: 'text',
        itemId: item.id,
        x: item.x,
        y: item.y,
        value: item.text,
        fontSize: item.fontSize,
        color: item.color,
      });
      setSelectedId(item.id);
      focusTextInput();
      return;
    }
    if (item && isLabeledMark(item)) {
      openLabelEditor(item);
      return;
    }
    setTextEditor({
      kind: 'text',
      itemId: null,
      x: fallbackPoint?.x ?? 0,
      y: fallbackPoint?.y ?? 0,
      value: '',
      fontSize,
      color: textColor,
    });
    setSelectedId(null);
    focusTextInput();
  }, [focusTextInput, fontSize, openLabelEditor, setSelectedId, textColor]);

  const handleCommitTextEditor = useCallback(() => {
    const editor = textEditor;
    if (!editor) {
      return;
    }
    const value = editor.value.replace(/\s+$/, '');

    if (editor.kind === 'label') {
      const nextItems = docRef.current.items.map((item) => {
        if (item.id !== editor.itemId || !isLabeledMark(item)) {
          return item;
        }
        if (!value.trim()) {
          const { label: _label, labelFontSize: _size, ...rest } = item;
          return rest as MarkItem;
        }
        return { ...item, label: value, labelFontSize: item.labelFontSize ?? editor.fontSize };
      });
      commitItems(nextItems);
      setTextEditor(null);
      return;
    }

    if (editor.itemId) {
      const nextItems = docRef.current.items
        .map((item) => {
          if (item.id !== editor.itemId || item.type !== 'text') {
            return item;
          }
          if (!value.trim()) {
            return null;
          }
          return { ...item, text: value };
        })
        .filter((item): item is MarkItem => item !== null);
      commitItems(nextItems);
      setTextEditor(null);
      return;
    }

    if (!value.trim()) {
      setTextEditor(null);
      return;
    }

    const nextItem: MarkItem = {
      id: createMarkId(),
      type: 'text',
      x: editor.x,
      y: editor.y,
      text: value,
      color: editor.color,
      fontSize: editor.fontSize,
    };
    commitItems([...docRef.current.items, nextItem]);
    setSelectedId(nextItem.id);
    setTextEditor(null);
  }, [commitItems, docRef, setSelectedId, textEditor]);

  const handleCancelTextEditor = useCallback(() => {
    setTextEditor(null);
  }, []);

  return {
    textEditor,
    setTextEditor,
    openLabelEditor,
    startTextEditing,
    handleCommitTextEditor,
    handleCancelTextEditor,
  };
}
