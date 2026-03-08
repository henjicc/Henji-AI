import { useCallback, useMemo, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type SetStateAction } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import type { ToolOptions } from '@/features/canvas/tools';
import { type AnnotationItem, type AnnotationToolType, stringifyAnnotationItems } from '@/features/canvas/tools/annotation';
import {
  buildDraftAnnotation,
  clamp,
  createAnnotationId,
  fontSizeToPercent,
  lineWidthToPercent,
  MAX_LINE_WIDTH_PERCENT,
  MAX_TEXT_SIZE_PERCENT,
  MIN_LINE_WIDTH_PERCENT,
  MIN_TEXT_SIZE_PERCENT,
  percentToFontSize,
  percentToLineWidth,
  pruneUndefinedToolOptionsPatch,
  toNumber,
  toText,
  type DraftState,
  type TextEditorState,
} from './shared';

interface UseAnnotateControllerParams {
  options: ToolOptions;
  onOptionsChange: (options: ToolOptions) => void;
  image: HTMLImageElement | null;
  annotations: AnnotationItem[];
  setAnnotations: Dispatch<SetStateAction<AnnotationItem[]>>;
  draft: DraftState | null;
  setDraft: Dispatch<SetStateAction<DraftState | null>>;
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  selectedAnnotation: AnnotationItem | null;
  textEditorState: TextEditorState | null;
  setTextEditorState: Dispatch<SetStateAction<TextEditorState | null>>;
  undoStack: AnnotationItem[][];
  setUndoStack: Dispatch<SetStateAction<AnnotationItem[][]>>;
  redoStack: AnnotationItem[][];
  setRedoStack: Dispatch<SetStateAction<AnnotationItem[][]>>;
  tool: AnnotationToolType;
  color: string;
  fontSize: number;
  lineWidth: number;
  textBaseSize: number;
  scale: number;
  stageRef: MutableRefObject<Konva.Stage | null>;
  contentGroupRef: MutableRefObject<Konva.Group | null>;
  stageHostRef: MutableRefObject<HTMLDivElement | null>;
  textInputRef: MutableRefObject<HTMLTextAreaElement | null>;
}

export function useAnnotateController({
  options,
  onOptionsChange,
  image,
  annotations,
  setAnnotations,
  draft,
  setDraft,
  selectedId,
  setSelectedId,
  selectedAnnotation,
  textEditorState,
  setTextEditorState,
  undoStack,
  setUndoStack,
  redoStack,
  setRedoStack,
  tool,
  color,
  fontSize,
  lineWidth,
  textBaseSize,
  scale,
  stageRef,
  contentGroupRef,
  stageHostRef,
  textInputRef,
}: UseAnnotateControllerParams) {
  const updateOptionsPayload = useCallback((nextAnnotations: AnnotationItem[], nextOptionsPatch: Partial<ToolOptions> = {}, saveHistory = false) => {
    if (saveHistory) {
      setUndoStack((prev) => [...prev, annotations].slice(-40));
      setRedoStack([]);
    }
    onOptionsChange({
      ...options,
      ...nextOptionsPatch,
      annotations: stringifyAnnotationItems(nextAnnotations),
    });
    setAnnotations(nextAnnotations);
  }, [annotations, onOptionsChange, options, setAnnotations, setRedoStack, setUndoStack]);

  const getImagePoint = useCallback(() => {
    const stage = stageRef.current;
    const group = contentGroupRef.current;
    if (!stage || !group || !image) {
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
      x: clamp(imagePoint.x, 0, image.naturalWidth),
      y: clamp(imagePoint.y, 0, image.naturalHeight),
    };
  }, [contentGroupRef, image, stageRef]);

  const toHostPoint = useCallback((x: number, y: number) => {
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

  const startTextEditing = useCallback((item: AnnotationItem | null, fallbackPoint?: { x: number; y: number }) => {
    const targetItem = item && item.type === 'text' ? item : null;
    const x = targetItem ? targetItem.x : (fallbackPoint?.x ?? 0);
    const y = targetItem ? targetItem.y : (fallbackPoint?.y ?? 0);
    setTextEditorState({
      annotationId: targetItem?.id ?? null,
      x,
      y,
      value: targetItem?.text ?? '',
    });
    setSelectedId(targetItem?.id ?? null);
    requestAnimationFrame(() => {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    });
  }, [setSelectedId, setTextEditorState, textInputRef]);

  const handleCommitTextEditor = useCallback(() => {
    if (!textEditorState) {
      return;
    }
    const value = textEditorState.value.trim();
    if (textEditorState.annotationId) {
      const nextAnnotations = annotations
        .map((item) => {
          if (item.id !== textEditorState.annotationId || item.type !== 'text') {
            return item;
          }
          if (!value) {
            return null;
          }
          return { ...item, text: value, color, fontSize };
        })
        .filter((item): item is AnnotationItem => Boolean(item));
      updateOptionsPayload(nextAnnotations, {}, true);
      setTextEditorState(null);
      return;
    }

    if (!value) {
      setTextEditorState(null);
      return;
    }

    const nextItem: AnnotationItem = {
      id: createAnnotationId(),
      type: 'text',
      x: textEditorState.x,
      y: textEditorState.y,
      text: value,
      color,
      fontSize,
    };
    const nextAnnotations = [...annotations, nextItem];
    updateOptionsPayload(nextAnnotations, {}, true);
    setSelectedId(nextItem.id);
    setTextEditorState(null);
  }, [annotations, color, fontSize, setSelectedId, setTextEditorState, textEditorState, updateOptionsPayload]);

  const handleCancelTextEditor = useCallback(() => {
    setTextEditorState(null);
  }, [setTextEditorState]);

  const draftAnnotation = useMemo(() => {
    if (!draft) {
      return null;
    }
    if (draft.tool === 'pen') {
      return {
        id: 'draft-pen',
        type: 'pen',
        points: draft.points ?? [draft.startX, draft.startY],
        stroke: color,
        lineWidth,
      } as AnnotationItem;
    }
    return buildDraftAnnotation(draft, draft.currentX, draft.currentY, color, lineWidth);
  }, [color, draft, lineWidth]);

  const handlePointerDown = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    stageHostRef.current?.focus();
    const point = getImagePoint();
    if (!point) {
      return;
    }

    const target = event.target;
    const isBackgroundTarget = target === target.getStage() || target.name() === 'annotation-background';
    if (!isBackgroundTarget) {
      return;
    }
    if (tool === 'text') {
      startTextEditing(null, point);
      return;
    }

    setTextEditorState(null);
    setSelectedId(null);
    setDraft({
      tool: tool as Exclude<AnnotationToolType, 'text'>,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      points: tool === 'pen' ? [point.x, point.y] : undefined,
    });
  }, [getImagePoint, setDraft, setSelectedId, setTextEditorState, stageHostRef, startTextEditing, tool]);

  const handlePointerMove = useCallback(() => {
    if (!draft) {
      return;
    }
    const point = getImagePoint();
    if (!point) {
      return;
    }
    if (draft.tool === 'pen') {
      setDraft((previous) => previous && previous.tool === 'pen'
        ? {
          ...previous,
          currentX: point.x,
          currentY: point.y,
          points: [...(previous.points ?? [previous.startX, previous.startY]), point.x, point.y],
        }
        : previous);
      return;
    }
    setDraft((previous) => previous ? { ...previous, currentX: point.x, currentY: point.y } : previous);
  }, [draft, getImagePoint, setDraft]);

  const handlePointerUp = useCallback(() => {
    if (!draft) {
      return;
    }
    const point = getImagePoint();
    const finalX = point?.x ?? draft.currentX;
    const finalY = point?.y ?? draft.currentY;
    const nextItem = buildDraftAnnotation(draft, finalX, finalY, color, lineWidth);
    if (!nextItem) {
      setDraft(null);
      return;
    }
    if ((nextItem.type === 'rect' || nextItem.type === 'ellipse') && (nextItem.width < 4 || nextItem.height < 4)) {
      setDraft(null);
      return;
    }
    if (nextItem.type === 'arrow') {
      const [x1, y1, x2, y2] = nextItem.points;
      if (Math.hypot(x2 - x1, y2 - y1) < 4) {
        setDraft(null);
        return;
      }
    }
    if (nextItem.type === 'pen' && nextItem.points.length < 6) {
      setDraft(null);
      return;
    }
    const createdItem = { ...nextItem, id: createAnnotationId() } as AnnotationItem;
    const nextAnnotations = [...annotations, createdItem];
    updateOptionsPayload(nextAnnotations, {}, true);
    setSelectedId(createdItem.id);
    setDraft(null);
  }, [annotations, color, draft, getImagePoint, lineWidth, setDraft, setSelectedId, updateOptionsPayload]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) {
      return;
    }
    const nextAnnotations = annotations.filter((item) => item.id !== selectedId);
    updateOptionsPayload(nextAnnotations, {}, true);
    setSelectedId(null);
  }, [annotations, selectedId, setSelectedId, updateOptionsPayload]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) {
      return;
    }
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [...prev, annotations].slice(-40));
    setUndoStack((prev) => prev.slice(0, -1));
    onOptionsChange({ ...options, annotations: stringifyAnnotationItems(previous) });
    setAnnotations(previous);
  }, [annotations, onOptionsChange, options, setAnnotations, setRedoStack, setUndoStack, undoStack]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) {
      return;
    }
    const next = redoStack[redoStack.length - 1];
    setUndoStack((prev) => [...prev, annotations].slice(-40));
    setRedoStack((prev) => prev.slice(0, -1));
    onOptionsChange({ ...options, annotations: stringifyAnnotationItems(next) });
    setAnnotations(next);
  }, [annotations, onOptionsChange, options, redoStack, setAnnotations, setRedoStack, setUndoStack]);

  const handleStyleInputChange = useCallback((patch: Partial<ToolOptions>) => {
    const safePatch = pruneUndefinedToolOptionsPatch(patch);
    const nextOptions = { ...options, ...safePatch } as ToolOptions;
    onOptionsChange(nextOptions);

    if (!selectedAnnotation) {
      return;
    }
    const nextAnnotations = annotations.map((item) => {
      if (item.id !== selectedAnnotation.id) {
        return item;
      }
      if (item.type === 'text') {
        const nextTextPercent = clamp(
          toNumber(nextOptions.fontSizePercent, fontSizeToPercent(item.fontSize, textBaseSize)),
          MIN_TEXT_SIZE_PERCENT,
          MAX_TEXT_SIZE_PERCENT
        );
        return {
          ...item,
          color: toText(nextOptions.color, item.color),
          fontSize: percentToFontSize(nextTextPercent, textBaseSize),
        };
      }
      return {
        ...item,
        stroke: toText(nextOptions.color, item.stroke),
        lineWidth: percentToLineWidth(
          clamp(
            toNumber(nextOptions.lineWidthPercent, lineWidthToPercent(item.lineWidth, textBaseSize)),
            MIN_LINE_WIDTH_PERCENT,
            MAX_LINE_WIDTH_PERCENT
          ),
          textBaseSize
        ),
      };
    });
    updateOptionsPayload(nextAnnotations, safePatch, true);
  }, [annotations, onOptionsChange, options, selectedAnnotation, textBaseSize, updateOptionsPayload]);

  const handleStageKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (textEditorState) {
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
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      handleDeleteSelected();
    }
  }, [handleDeleteSelected, handleRedo, handleUndo, textEditorState]);

  const textEditorStagePos = useMemo(() => {
    if (!textEditorState) {
      return null;
    }
    return toHostPoint(textEditorState.x, textEditorState.y);
  }, [textEditorState, toHostPoint]);

  return {
    draftAnnotation,
    textEditorStagePos,
    updateOptionsPayload,
    startTextEditing,
    handleCommitTextEditor,
    handleCancelTextEditor,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleDeleteSelected,
    handleUndo,
    handleRedo,
    handleStyleInputChange,
    handleStageKeyDown,
  };
}
