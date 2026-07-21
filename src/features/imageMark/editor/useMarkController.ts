import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type Konva from 'konva';
import { IMAGE_EDITOR_PRESET_COLORS } from '@/core/theme/colorTokens';
import { clamp, updateMarkPosition } from '../domain/geometry';
import { percentToFontSize, percentToLineWidth, resolveLabelPlacement } from '../domain/metrics';
import { isLabeledMark, type ImageMarkDoc, type MarkToolType } from '../domain/types';
import { TOOL_SHORTCUT_MAP, getMarkPosition, type MarkEditorStyleState } from './shared';
import { useMarkCropOrientation } from './useMarkCropOrientation';
import { useMarkHistory } from './useMarkHistory';
import { useMarkPointer } from './useMarkPointer';
import { useMarkStyleSync } from './useMarkStyleSync';
import { useMarkTextEditing } from './useMarkTextEditing';

export type { NumericStyleKey } from './useMarkStyleSync';

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
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  // 标签是否为当前激活的子选中目标(区别于其父图形);任何非标签路径的选中都清空它
  const [activeLabelId, setActiveLabelId] = useState<string | null>(null);
  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id);
    setActiveLabelId(null);
  }, []);
  const selectLabel = useCallback((id: string) => {
    setSelectedIdState(id);
    setActiveLabelId(id);
  }, []);
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

  const draftOptions = useMemo(() => ({
    mosaicStrengthPercent: style.mosaicStrengthPercent,
    mosaicMode: style.mosaicMode,
    calloutShape: style.calloutShape,
  }), [style.calloutShape, style.mosaicMode, style.mosaicStrengthPercent]);

  const pointer = useMarkPointer({
    docRef,
    tool,
    color: style.color,
    lineWidth,
    fontSize,
    draftOptions,
    isTextEditorOpen: Boolean(textEditing.textEditor),
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

  const toolRef = useRef(tool);
  toolRef.current = tool;

  const selectTool = useCallback((next: MarkToolType) => {
    // 离开裁剪工具时,没动过的全图初始框静默清掉,避免残留虚线/意外裁剪
    if (toolRef.current === 'crop' && next !== 'crop') {
      cropOrientation.normalizeCropSilently();
    }
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
  }, [history, selectedId, setSelectedId, textEditing]);

  const handleClear = useCallback(() => {
    if (docRef.current.items.length === 0) {
      return;
    }
    history.commitItems([]);
    setSelectedId(null);
    textEditing.setTextEditor(null);
  }, [history, setSelectedId, textEditing]);

  // ==================== 样式变更(同时作用于选中项)/ 滚轮微调 ====================

  const { handleStylePatch, adjustStyleByWheel, adjustSelectedByWheel } = useMarkStyleSync({
    docRef,
    selectedItem,
    activeLabelId,
    style,
    setStyle,
    onStyleChange,
    baseSize,
    commitItems: history.commitItems,
    pushHistorySnapshot: history.pushHistorySnapshot,
    isTextEditorOpen: Boolean(textEditing.textEditor),
  });

  // ==================== 键盘 ====================

  const handleEditorKeyDown = useCallback((event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    preventDefault: () => void;
  }) => {
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
  }, [handleDeleteSelected, handleStylePatch, history, pointer, selectTool, selectedId, setSelectedId, textEditing.textEditor]);

  // 标签原位输入的锚点必须随实时输入内容重算(与最终渲染用同一函数),
  // 否则确认时会因为占位符宽度与真实文字宽度不同而发生跳动
  const textEditorHostPos = useMemo(() => {
    const editor = textEditing.textEditor;
    if (!editor) {
      return null;
    }
    if (editor.kind === 'label') {
      const parentItem = doc.items.find((item) => item.id === editor.itemId);
      if (parentItem && isLabeledMark(parentItem)) {
        // 必须带上编辑中的字号:未确认的标签尚无 labelFontSize,否则定位会退回默认字号导致确认时跳动
        const placement = resolveLabelPlacement(
          { ...parentItem, label: editor.value, labelFontSize: editor.fontSize },
          imageWidth,
          imageHeight
        );
        return toHostPoint(placement.x, placement.y);
      }
    }
    return toHostPoint(editor.x, editor.y);
  }, [doc.items, imageHeight, imageWidth, textEditing.textEditor, toHostPoint]);

  return {
    draftMark: pointer.draftMark,
    selectedId,
    setSelectedId,
    activeLabelId,
    selectLabel,
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
    adjustStyleByWheel,
    adjustSelectedByWheel,
    handlePointerDown: pointer.handlePointerDown,
    handlePointerMove: pointer.handlePointerMove,
    handlePointerUp: pointer.handlePointerUp,
    handleStageDblClick: pointer.handleStageDblClick,
    handleEditorKeyDown,
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
