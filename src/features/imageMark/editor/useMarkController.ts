import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type Konva from 'konva';
import { IMAGE_EDITOR_PRESET_COLORS } from '@/core/theme/colorTokens';
import { clamp, updateMarkPosition } from '../domain/geometry';
import {
  MAX_LINE_WIDTH_PERCENT,
  MAX_TEXT_SIZE_PERCENT,
  MIN_LINE_WIDTH_PERCENT,
  MIN_TEXT_SIZE_PERCENT,
  fontSizeToPercent,
  lineWidthToPercent,
  percentToFontSize,
  percentToLineWidth,
} from '../domain/metrics';
import type { ImageMarkDoc, MarkToolType } from '../domain/types';
import { TOOL_SHORTCUT_MAP, getMarkPosition, type MarkEditorStyleState } from './shared';
import { useMarkCropOrientation } from './useMarkCropOrientation';
import { useMarkHistory } from './useMarkHistory';
import { useMarkPointer } from './useMarkPointer';
import { useMarkTextEditing } from './useMarkTextEditing';

export interface UseMarkControllerParams {
  doc: ImageMarkDoc;
  setDoc: Dispatch<SetStateAction<ImageMarkDoc>>;
  onDocChange?: (doc: ImageMarkDoc) => void;
  imageWidth: number;
  imageHeight: number;
  baseSize: number;
  scale: number;
  tool: MarkToolType;
  setTool: (tool: MarkToolType) => void;
  style: MarkEditorStyleState;
  setStyle: Dispatch<SetStateAction<MarkEditorStyleState>>;
  onStyleChange?: (style: MarkEditorStyleState) => void;
  stageRef: MutableRefObject<Konva.Stage | null>;
  contentGroupRef: MutableRefObject<Konva.Group | null>;
  stageHostRef: MutableRefObject<HTMLDivElement | null>;
  textInputRef: MutableRefObject<HTMLTextAreaElement | null>;
}

/** 编辑器总控:组合历史、文字/标签、指针、裁剪/朝向子控制器,并承载选中、样式与键盘 */
export function useMarkController({
  doc,
  setDoc,
  onDocChange,
  imageWidth,
  imageHeight,
  baseSize,
  scale,
  tool,
  setTool,
  style,
  setStyle,
  onStyleChange,
  stageRef,
  contentGroupRef,
  stageHostRef,
  textInputRef,
}: UseMarkControllerParams) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const lineWidth = percentToLineWidth(style.lineWidthPercent, baseSize);
  const fontSize = percentToFontSize(style.textSizePercent, baseSize);
  const labelFontSize = Math.max(12, Math.round(fontSize * 0.55));

  const selectedItem = useMemo(
    () => doc.items.find((item) => item.id === selectedId) ?? null,
    [doc.items, selectedId]
  );

  // 撤销/重做/朝向切换后的清理,由子 hook 通过 ref 回调触发
  const interactionCleanupRef = useRef<() => void>(() => undefined);
  const runInteractionCleanup = useCallback(() => {
    interactionCleanupRef.current();
  }, []);

  const history = useMarkHistory({
    docRef,
    setDoc,
    onDocChange,
    onHistoryNavigate: runInteractionCleanup,
  });

  // ==================== 坐标转换 ====================

  const getImagePoint = useCallback((): { x: number; y: number } | null => {
    const stage = stageRef.current;
    const group = contentGroupRef.current;
    if (!stage || !group || imageWidth <= 0) {
      return null;
    }
    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return null;
    }
    const transform = group.getAbsoluteTransform().copy();
    transform.invert();
    const imagePoint = transform.point(pointer);
    return {
      x: clamp(imagePoint.x, 0, imageWidth),
      y: clamp(imagePoint.y, 0, imageHeight),
    };
  }, [contentGroupRef, imageHeight, imageWidth, stageRef]);

  const toHostPoint = useCallback((x: number, y: number): { x: number; y: number } => {
    const group = contentGroupRef.current;
    const stage = stageRef.current;
    const host = stageHostRef.current;
    const stagePoint = group
      ? group.getAbsoluteTransform().point({ x, y })
      : { x: x * scale, y: y * scale };
    if (!stage || !host) {
      return stagePoint;
    }
    const stageRect = stage.container().getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    return {
      x: stagePoint.x + (stageRect.left - hostRect.left),
      y: stagePoint.y + (stageRect.top - hostRect.top),
    };
  }, [contentGroupRef, scale, stageHostRef, stageRef]);

  // ==================== 子控制器 ====================

  const textEditing = useMarkTextEditing({
    docRef,
    commitItems: history.commitItems,
    setSelectedId,
    imageWidth,
    imageHeight,
    textInputRef,
    textColor: style.color,
    fontSize,
    labelFontSize,
  });

  const pointer = useMarkPointer({
    docRef,
    tool,
    color: style.color,
    lineWidth,
    fontSize,
    commitItems: history.commitItems,
    setSelectedId,
    setTextEditor: textEditing.setTextEditor,
    startTextEditing: textEditing.startTextEditing,
    openLabelEditor: textEditing.openLabelEditor,
    getImagePoint,
    stageHostRef,
  });

  const cropOrientation = useMarkCropOrientation({
    docRef,
    setDoc,
    onDocChange,
    commitDoc: history.commitDoc,
    pushHistorySnapshot: history.pushHistorySnapshot,
    imageWidth,
    imageHeight,
    onBeforeOrientation: runInteractionCleanup,
  });

  interactionCleanupRef.current = () => {
    setSelectedId(null);
    textEditing.setTextEditor(null);
    pointer.setDraft(null);
  };

  // ==================== 工具切换 ====================

  const selectTool = useCallback((next: MarkToolType) => {
    setTool(next);
    if (next === 'crop') {
      cropOrientation.ensureCropExists();
    }
    if (next !== 'text') {
      textEditing.setTextEditor(null);
    }
    pointer.setDraft(null);
  }, [cropOrientation, pointer, setTool, textEditing]);

  // ==================== 删除 / 清空 ====================

  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) {
      return;
    }
    history.commitItems(docRef.current.items.filter((item) => item.id !== selectedId));
    setSelectedId(null);
    textEditing.setTextEditor(null);
  }, [history, selectedId, textEditing]);

  const handleClear = useCallback(() => {
    if (docRef.current.items.length === 0) {
      return;
    }
    history.commitItems([]);
    setSelectedId(null);
    textEditing.setTextEditor(null);
  }, [history, textEditing]);

  // ==================== 样式变更(同时作用于选中项) ====================

  const handleStylePatch = useCallback((patch: Partial<MarkEditorStyleState>) => {
    const nextStyle: MarkEditorStyleState = {
      color: patch.color ?? style.color,
      lineWidthPercent: clamp(
        patch.lineWidthPercent ?? style.lineWidthPercent,
        MIN_LINE_WIDTH_PERCENT,
        MAX_LINE_WIDTH_PERCENT
      ),
      textSizePercent: clamp(
        patch.textSizePercent ?? style.textSizePercent,
        MIN_TEXT_SIZE_PERCENT,
        MAX_TEXT_SIZE_PERCENT
      ),
    };
    setStyle(nextStyle);
    onStyleChange?.(nextStyle);

    if (!selectedItem) {
      return;
    }
    const nextItems = docRef.current.items.map((item) => {
      if (item.id !== selectedItem.id) {
        return item;
      }
      if (item.type === 'text' || item.type === 'number') {
        return {
          ...item,
          color: nextStyle.color,
          fontSize: percentToFontSize(nextStyle.textSizePercent, baseSize),
        };
      }
      if (item.type === 'mosaic') {
        return item;
      }
      return {
        ...item,
        stroke: nextStyle.color,
        lineWidth: percentToLineWidth(nextStyle.lineWidthPercent, baseSize),
      };
    });
    history.commitItems(nextItems);
  }, [baseSize, history, onStyleChange, selectedItem, setStyle, style]);

  // 选中项变化时,把样式面板同步为该项的样式
  useEffect(() => {
    if (!selectedItem || textEditing.textEditor) {
      return;
    }
    let patch: Partial<MarkEditorStyleState> = {};
    if (selectedItem.type === 'text' || selectedItem.type === 'number') {
      patch = {
        color: selectedItem.color,
        textSizePercent: clamp(
          fontSizeToPercent(selectedItem.fontSize, baseSize),
          MIN_TEXT_SIZE_PERCENT,
          MAX_TEXT_SIZE_PERCENT
        ),
      };
    } else if (selectedItem.type !== 'mosaic') {
      patch = {
        color: selectedItem.stroke,
        lineWidthPercent: clamp(
          lineWidthToPercent(selectedItem.lineWidth, baseSize),
          MIN_LINE_WIDTH_PERCENT,
          MAX_LINE_WIDTH_PERCENT
        ),
      };
    }
    setStyle((previous) => {
      const next = { ...previous, ...patch };
      const changed = Object.entries(patch).some(
        ([key, value]) => !Object.is(previous[key as keyof MarkEditorStyleState], value)
      );
      return changed ? next : previous;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在选中项变化时同步一次样式
  }, [selectedItem?.id]);

  // ==================== 键盘 ====================

  const handleStageKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (textEditing.textEditor) {
      return;
    }
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey;

    if (command && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      history.handleUndo();
      return;
    }
    if (command && (key === 'y' || (key === 'z' && event.shiftKey))) {
      event.preventDefault();
      history.handleRedo();
      return;
    }
    if (command) {
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      handleDeleteSelected();
      return;
    }
    if (event.key === 'Escape') {
      if (pointer.draft) {
        event.preventDefault();
        pointer.setDraft(null);
        return;
      }
      if (selectedId) {
        event.preventDefault();
        setSelectedId(null);
        return;
      }
      return;
    }

    if (event.key.startsWith('Arrow') && selectedId) {
      const item = docRef.current.items.find((entry) => entry.id === selectedId);
      if (!item) {
        return;
      }
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      const position = getMarkPosition(item);
      history.commitItems(
        docRef.current.items.map((entry) =>
          entry.id === selectedId
            ? updateMarkPosition(entry, position.x + dx, position.y + dy)
            : entry
        )
      );
      return;
    }

    const digit = Number.parseInt(event.key, 10);
    if (Number.isInteger(digit) && digit >= 1 && digit <= IMAGE_EDITOR_PRESET_COLORS.length) {
      event.preventDefault();
      handleStylePatch({ color: IMAGE_EDITOR_PRESET_COLORS[digit - 1] });
      return;
    }

    const shortcutTool = TOOL_SHORTCUT_MAP[key];
    if (shortcutTool) {
      event.preventDefault();
      selectTool(shortcutTool);
    }
  }, [handleDeleteSelected, handleStylePatch, history, pointer, selectTool, selectedId, textEditing.textEditor]);

  const textEditorHostPos = useMemo(() => {
    if (!textEditing.textEditor) {
      return null;
    }
    return toHostPoint(textEditing.textEditor.x, textEditing.textEditor.y);
  }, [textEditing.textEditor, toHostPoint]);

  return {
    draftMark: pointer.draftMark,
    selectedId,
    setSelectedId,
    selectedItem,
    textEditor: textEditing.textEditor,
    setTextEditor: textEditing.setTextEditor,
    textEditorHostPos,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    selectTool,
    commitDoc: history.commitDoc,
    commitItems: history.commitItems,
    handleUndo: history.handleUndo,
    handleRedo: history.handleRedo,
    handleDeleteSelected,
    handleClear,
    handleStylePatch,
    handlePointerDown: pointer.handlePointerDown,
    handlePointerMove: pointer.handlePointerMove,
    handlePointerUp: pointer.handlePointerUp,
    handleStageDblClick: pointer.handleStageDblClick,
    handleStageKeyDown,
    startTextEditing: textEditing.startTextEditing,
    handleCommitTextEditor: textEditing.handleCommitTextEditor,
    handleCancelTextEditor: textEditing.handleCancelTextEditor,
    applyOrientation: cropOrientation.applyOrientation,
    ensureCropExists: cropOrientation.ensureCropExists,
    handleCropChange: cropOrientation.handleCropChange,
    handleCropCommit: cropOrientation.handleCropCommit,
    handleCropReset: cropOrientation.handleCropReset,
  };
}
