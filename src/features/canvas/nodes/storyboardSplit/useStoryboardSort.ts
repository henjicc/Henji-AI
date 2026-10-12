import { useCallback, useMemo } from 'react';
import type { PointerEvent } from 'react';
import { useReorderDrag, type ReorderDragResult } from '@/components/ui/fileUploader/useReorderDrag';
import type { StoryboardFrameItem } from '@/features/canvas/domain/canvasNodes';

interface UseStoryboardSortParams {
  nodeId: string;
  frames: StoryboardFrameItem[];
  reorderStoryboardFrame: (nodeId: string, draggedFrameId: string, targetFrameId: string) => void;
  onSortStart?: () => void;
}

interface UseStoryboardSortResult {
  draggedFrameId: string | null;
  dropTargetFrameId: string | null;
  itemRefs: ReorderDragResult['itemRefs'];
  handleSortStart: (index: number, event: PointerEvent) => void;
}

export function useStoryboardSort({ nodeId, frames, reorderStoryboardFrame, onSortStart }: UseStoryboardSortParams): UseStoryboardSortResult {
  const files = useMemo(() => frames.map((frame) => frame.id), [frames]);
  const onReorder = useCallback((from: number, to: number): void => {
    if (files[from] && files[to]) reorderStoryboardFrame(nodeId, files[from], files[to]);
  }, [files, nodeId, reorderStoryboardFrame]);
  const { dragState, itemRefs, handlePointerDown } = useReorderDrag({
    files, disabled: false, isCustomDragging: false, layout: 'grid', onReorder,
  });
  const handleSortStart = useCallback((index: number, event: PointerEvent): void => {
    onSortStart?.();
    handlePointerDown(index, event);
  }, [handlePointerDown, onSortStart]);
  return {
    draggedFrameId: dragState.isDragging || dragState.isDropping ? files[dragState.fromIndex ?? -1] ?? null : null,
    dropTargetFrameId: dragState.isDragging || dragState.isDropping ? files[dragState.toIndex ?? -1] ?? null : null,
    itemRefs, handleSortStart,
  };
}
