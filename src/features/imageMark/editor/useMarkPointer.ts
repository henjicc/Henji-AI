import { useCallback, useMemo, useState, type MutableRefObject } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { createMarkId } from '../domain/codec';
import { isLabeledMark, type ImageMarkDoc, type LabeledMark, type MarkItem, type MarkToolType } from '../domain/types';
import { buildDraftMark, type DraftState } from './shared';

export interface UseMarkPointerParams {
  docRef: MutableRefObject<ImageMarkDoc>;
  tool: MarkToolType;
  color: string;
  lineWidth: number;
  fontSize: number;
  mosaicStrengthPercent: number;
  commitItems: (items: MarkItem[], recordHistory?: boolean) => void;
  setSelectedId: (id: string | null) => void;
  setTextEditor: (state: null) => void;
  startTextEditing: (item: MarkItem | null, fallbackPoint?: { x: number; y: number }) => void;
  openLabelEditor: (item: LabeledMark) => void;
  getImagePoint: () => { x: number; y: number } | null;
  stageHostRef: MutableRefObject<HTMLDivElement | null>;
}

/** 舞台指针交互:绘制草稿、序号点选、完成后打开标签输入 */
export function useMarkPointer({
  docRef,
  tool,
  color,
  lineWidth,
  fontSize,
  mosaicStrengthPercent,
  commitItems,
  setSelectedId,
  setTextEditor,
  startTextEditing,
  openLabelEditor,
  getImagePoint,
  stageHostRef,
}: UseMarkPointerParams) {
  const [draft, setDraft] = useState<DraftState | null>(null);

  const draftMark = useMemo(
    () => buildDraftMark(draft, color, lineWidth, mosaicStrengthPercent),
    [color, draft, lineWidth, mosaicStrengthPercent]
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
        color,
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
  }, [color, commitItems, docRef, fontSize, getImagePoint, isBackgroundTarget, setSelectedId, setTextEditor, stageHostRef, startTextEditing, tool]);

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

    const nextItem = buildDraftMark(finalDraft, color, lineWidth, mosaicStrengthPercent);
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

    // 标注工具:画完立刻在框右下角给出文字输入;纯图形工具不打扰
    if (finalDraft.tool === 'callout' && isLabeledMark(createdItem)) {
      openLabelEditor(createdItem);
    }
  }, [color, commitItems, docRef, draft, lineWidth, mosaicStrengthPercent, openLabelEditor, setSelectedId]);

  const handleStageDblClick = useCallback((event: KonvaEventObject<MouseEvent>) => {
    if (tool === 'crop' || !isBackgroundTarget(event)) {
      return;
    }
    const point = getImagePoint();
    if (point) {
      startTextEditing(null, point);
    }
  }, [getImagePoint, isBackgroundTarget, startTextEditing, tool]);

  return {
    draft,
    setDraft,
    draftMark,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleStageDblClick,
  };
}
