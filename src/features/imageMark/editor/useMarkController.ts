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
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { IMAGE_EDITOR_PRESET_COLORS } from '@/core/theme/colorTokens';
import { createMarkId } from '../domain/codec';
import {
  applyOrientationOpToDoc,
  clamp,
  clampCropRect,
  updateMarkPosition,
  type OrientationOp,
} from '../domain/geometry';
import {
  MAX_LINE_WIDTH_PERCENT,
  MAX_TEXT_SIZE_PERCENT,
  MIN_LINE_WIDTH_PERCENT,
  MIN_TEXT_SIZE_PERCENT,
  fontSizeToPercent,
  lineWidthToPercent,
  percentToFontSize,
  percentToLineWidth,
  resolveLabelPlacement,
} from '../domain/metrics';
import {
  isLabeledMark,
  type ImageMarkDoc,
  type MarkCropRect,
  type MarkItem,
  type MarkToolType,
} from '../domain/types';
import {
  HISTORY_LIMIT,
  TOOL_SHORTCUT_MAP,
  buildDraftMark,
  getMarkPosition,
  type DraftState,
  type MarkEditorStyleState,
  type TextEditorState,
} from './shared';

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
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const [undoStack, setUndoStack] = useState<ImageMarkDoc[]>([]);
  const [redoStack, setRedoStack] = useState<ImageMarkDoc[]>([]);
  const cropGestureBaseRef = useRef<ImageMarkDoc | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const lineWidth = percentToLineWidth(style.lineWidthPercent, baseSize);
  const fontSize = percentToFontSize(style.textSizePercent, baseSize);
  const labelFontSize = Math.max(12, Math.round(fontSize * 0.55));

  const selectedItem = useMemo(
    () => doc.items.find((item) => item.id === selectedId) ?? null,
    [doc.items, selectedId]
  );

  const emitStyle = useCallback((next: MarkEditorStyleState) => {
    setStyle(next);
    onStyleChange?.(next);
  }, [onStyleChange, setStyle]);

  // ==================== 文档提交与历史 ====================

  const commitDoc = useCallback((next: ImageMarkDoc, recordHistory = true) => {
    if (recordHistory) {
      setUndoStack((prev) => [...prev, docRef.current].slice(-HISTORY_LIMIT));
      setRedoStack([]);
    }
    setDoc(next);
    onDocChange?.(next);
  }, [onDocChange, setDoc]);

  const commitItems = useCallback((items: MarkItem[], recordHistory = true) => {
    commitDoc({ ...docRef.current, items }, recordHistory);
  }, [commitDoc]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) {
      return;
    }
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((redo) => [...redo, docRef.current].slice(-HISTORY_LIMIT));
    setDoc(previous);
    onDocChange?.(previous);
    setSelectedId(null);
    setTextEditor(null);
    setDraft(null);
  }, [onDocChange, setDoc, undoStack]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) {
      return;
    }
    const next = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((undo) => [...undo, docRef.current].slice(-HISTORY_LIMIT));
    setDoc(next);
    onDocChange?.(next);
    setSelectedId(null);
    setTextEditor(null);
    setDraft(null);
  }, [onDocChange, redoStack, setDoc]);

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

  // ==================== 文字 / 标签编辑 ====================

  const focusTextInput = useCallback(() => {
    requestAnimationFrame(() => {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    });
  }, [textInputRef]);

  const startTextEditing = useCallback((item: MarkItem | null, fallbackPoint?: { x: number; y: number }) => {
    if (item && item.type === 'text') {
      setTextEditor({ kind: 'text', itemId: item.id, x: item.x, y: item.y, value: item.text });
      setSelectedId(item.id);
      focusTextInput();
      return;
    }
    if (item && isLabeledMark(item)) {
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
      });
      setSelectedId(item.id);
      focusTextInput();
      return;
    }
    setTextEditor({
      kind: 'text',
      itemId: null,
      x: fallbackPoint?.x ?? 0,
      y: fallbackPoint?.y ?? 0,
      value: '',
    });
    setSelectedId(null);
    focusTextInput();
  }, [focusTextInput, imageHeight, imageWidth]);

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
        return { ...item, label: value, labelFontSize: item.labelFontSize ?? labelFontSize };
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
      color: style.color,
      fontSize,
    };
    commitItems([...docRef.current.items, nextItem]);
    setSelectedId(nextItem.id);
    setTextEditor(null);
  }, [commitItems, fontSize, labelFontSize, style.color, textEditor]);

  const handleCancelTextEditor = useCallback(() => {
    setTextEditor(null);
  }, []);

  // ==================== 指针交互 ====================

  const draftMark = useMemo(
    () => buildDraftMark(draft, style.color, lineWidth),
    [draft, lineWidth, style.color]
  );

  const isBackgroundTarget = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const target = event.target;
    return target === target.getStage() || target.name() === 'mark-background';
  }, []);

  const handlePointerDown = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    stageHostRef.current?.focus({ preventScroll: true });
    if (tool === 'crop') {
      return;
    }
    const point = getImagePoint();
    if (!point) {
      return;
    }
    if (!isBackgroundTarget(event)) {
      return;
    }

    if (tool === 'select') {
      setSelectedId(null);
      setTextEditor(null);
      return;
    }

    if (tool === 'text') {
      startTextEditing(null, point);
      return;
    }

    if (tool === 'number') {
      setTextEditor(null);
      const nextItem: MarkItem = {
        id: createMarkId(),
        type: 'number',
        x: point.x,
        y: point.y,
        color: style.color,
        fontSize,
      };
      commitItems([...docRef.current.items, nextItem]);
      return;
    }

    setTextEditor(null);
    setSelectedId(null);
    const shiftKey = 'shiftKey' in event.evt ? event.evt.shiftKey : false;
    setDraft({
      tool,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      shiftKey,
      points: tool === 'pen' ? [point.x, point.y] : undefined,
    });
  }, [commitItems, fontSize, getImagePoint, isBackgroundTarget, stageHostRef, startTextEditing, style.color, tool]);

  const handlePointerMove = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!draft) {
      return;
    }
    const point = getImagePoint();
    if (!point) {
      return;
    }
    const shiftKey = 'shiftKey' in event.evt ? event.evt.shiftKey : draft.shiftKey;
    setDraft((previous) => {
      if (!previous) {
        return previous;
      }
      if (previous.tool === 'pen') {
        return {
          ...previous,
          currentX: point.x,
          currentY: point.y,
          shiftKey,
          points: [...(previous.points ?? [previous.startX, previous.startY]), point.x, point.y],
        };
      }
      return { ...previous, currentX: point.x, currentY: point.y, shiftKey };
    });
  }, [draft, getImagePoint]);

  const handlePointerUp = useCallback(() => {
    if (!draft) {
      return;
    }
    const finalDraft: DraftState = { ...draft };
    setDraft(null);

    const nextItem = buildDraftMark(finalDraft, style.color, lineWidth);
    if (!nextItem) {
      return;
    }
    if (
      (nextItem.type === 'rect' || nextItem.type === 'ellipse' || nextItem.type === 'mosaic') &&
      (nextItem.width < 4 || nextItem.height < 4)
    ) {
      return;
    }
    if (nextItem.type === 'arrow') {
      const [x1, y1, x2, y2] = nextItem.points;
      if (Math.hypot(x2 - x1, y2 - y1) < 4) {
        return;
      }
    }
    if (nextItem.type === 'pen' && nextItem.points.length < 6) {
      return;
    }

    const createdItem = { ...nextItem, id: createMarkId() } as MarkItem;
    commitItems([...docRef.current.items, createdItem]);
    setSelectedId(createdItem.id);

    // 框选/箭头完成后立刻在旁边给出文字输入
    if (isLabeledMark(createdItem)) {
      const placement = resolveLabelPlacement(
        { ...createdItem, label: '标' },
        imageWidth,
        imageHeight
      );
      setTextEditor({
        kind: 'label',
        itemId: createdItem.id,
        x: placement.x,
        y: placement.y,
        value: '',
      });
      focusTextInput();
    }
  }, [commitItems, draft, focusTextInput, imageHeight, imageWidth, lineWidth, style.color]);

  const handleStageDblClick = useCallback((event: KonvaEventObject<MouseEvent>) => {
    if (tool === 'crop' || !isBackgroundTarget(event)) {
      return;
    }
    const point = getImagePoint();
    if (point) {
      startTextEditing(null, point);
    }
  }, [getImagePoint, isBackgroundTarget, startTextEditing, tool]);

  // ==================== 删除 / 清空 ====================

  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) {
      return;
    }
    commitItems(docRef.current.items.filter((item) => item.id !== selectedId));
    setSelectedId(null);
    setTextEditor(null);
  }, [commitItems, selectedId]);

  const handleClear = useCallback(() => {
    if (docRef.current.items.length === 0) {
      return;
    }
    commitItems([]);
    setSelectedId(null);
    setTextEditor(null);
  }, [commitItems]);

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
    emitStyle(nextStyle);

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
    commitItems(nextItems);
  }, [baseSize, commitItems, emitStyle, selectedItem, style]);

  // 选中项变化时,把样式面板同步为该项的样式
  useEffect(() => {
    if (!selectedItem || textEditor) {
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

  // ==================== 朝向与裁剪 ====================

  // ==================== 工具切换 ====================

  const ensureCropExistsRef = useRef<() => void>(() => undefined);

  const selectTool = useCallback((next: MarkToolType) => {
    setTool(next);
    if (next === 'crop') {
      ensureCropExistsRef.current();
    }
    if (next !== 'text') {
      setTextEditor(null);
    }
    setDraft(null);
  }, [setTool]);

  const applyOrientation = useCallback((op: OrientationOp) => {
    setDraft(null);
    setTextEditor(null);
    setSelectedId(null);
    commitDoc(applyOrientationOpToDoc(docRef.current, imageWidth, imageHeight, op));
  }, [commitDoc, imageHeight, imageWidth]);

  const normalizeCrop = useCallback((crop: MarkCropRect | null): MarkCropRect | null => {
    if (!crop) {
      return null;
    }
    const clamped = clampCropRect(crop, imageWidth, imageHeight);
    const coversAll =
      clamped.x <= 0.5 &&
      clamped.y <= 0.5 &&
      clamped.width >= imageWidth - 1 &&
      clamped.height >= imageHeight - 1;
    return coversAll ? null : clamped;
  }, [imageHeight, imageWidth]);

  const ensureCropExists = useCallback(() => {
    if (docRef.current.crop || imageWidth <= 0) {
      return;
    }
    const inset = 0.1;
    const crop: MarkCropRect = {
      x: imageWidth * inset,
      y: imageHeight * inset,
      width: imageWidth * (1 - inset * 2),
      height: imageHeight * (1 - inset * 2),
    };
    // 进入裁剪时的初始框不记历史,由确认/拖拽提交
    setDoc((previous) => ({ ...previous, crop }));
  }, [imageHeight, imageWidth, setDoc]);

  ensureCropExistsRef.current = ensureCropExists;

  const handleCropChange = useCallback((crop: MarkCropRect) => {
    if (!cropGestureBaseRef.current) {
      cropGestureBaseRef.current = docRef.current;
    }
    setDoc((previous) => ({ ...previous, crop }));
  }, [setDoc]);

  const handleCropCommit = useCallback(() => {
    const base = cropGestureBaseRef.current;
    cropGestureBaseRef.current = null;
    const next = { ...docRef.current, crop: normalizeCrop(docRef.current.crop) };
    if (base) {
      setUndoStack((prev) => [...prev, base].slice(-HISTORY_LIMIT));
      setRedoStack([]);
    }
    setDoc(next);
    onDocChange?.(next);
  }, [normalizeCrop, onDocChange, setDoc]);

  const handleCropReset = useCallback(() => {
    if (!docRef.current.crop) {
      return;
    }
    commitDoc({ ...docRef.current, crop: null });
  }, [commitDoc]);

  // ==================== 键盘 ====================

  const handleStageKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (textEditor) {
      return;
    }
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey;

    if (command && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      handleUndo();
      return;
    }
    if (command && (key === 'y' || (key === 'z' && event.shiftKey))) {
      event.preventDefault();
      handleRedo();
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
      if (draft) {
        event.preventDefault();
        setDraft(null);
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
      commitItems(
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
  }, [
    commitItems,
    draft,
    handleDeleteSelected,
    handleRedo,
    handleStylePatch,
    handleUndo,
    selectTool,
    selectedId,
    textEditor,
  ]);

  const textEditorHostPos = useMemo(() => {
    if (!textEditor) {
      return null;
    }
    return toHostPoint(textEditor.x, textEditor.y);
  }, [textEditor, toHostPoint]);

  return {
    draft,
    setDraft,
    draftMark,
    selectedId,
    setSelectedId,
    selectedItem,
    textEditor,
    setTextEditor,
    textEditorHostPos,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    selectTool,
    commitDoc,
    commitItems,
    handleUndo,
    handleRedo,
    handleDeleteSelected,
    handleClear,
    handleStylePatch,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleStageDblClick,
    handleStageKeyDown,
    startTextEditing,
    handleCommitTextEditor,
    handleCancelTextEditor,
    applyOrientation,
    ensureCropExists,
    handleCropChange,
    handleCropCommit,
    handleCropReset,
  };
}
