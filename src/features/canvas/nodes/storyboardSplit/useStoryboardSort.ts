import { useCallback, useEffect, useState } from 'react';

interface UseStoryboardSortParams {
  nodeId: string;
  reorderStoryboardFrame: (nodeId: string, draggedFrameId: string, targetFrameId: string) => void;
  onSortStart?: () => void;
}

interface UseStoryboardSortResult {
  draggedFrameId: string | null;
  dropTargetFrameId: string | null;
  handleSortStart: (frameId: string) => void;
  handleSortHover: (frameId: string) => void;
}

export function useStoryboardSort({
  nodeId,
  reorderStoryboardFrame,
  onSortStart,
}: UseStoryboardSortParams): UseStoryboardSortResult {
  const [draggedFrameId, setDraggedFrameId] = useState<string | null>(null);
  const [dropTargetFrameId, setDropTargetFrameId] = useState<string | null>(null);

  const handleSortStart = useCallback((frameId: string) => {
    setDraggedFrameId(frameId);
    setDropTargetFrameId(frameId);
    onSortStart?.();
  }, [onSortStart]);

  const handleSortHover = useCallback((frameId: string) => {
    if (!draggedFrameId) {
      return;
    }
    setDropTargetFrameId(frameId);
  }, [draggedFrameId]);

  const finalizeSort = useCallback(() => {
    if (!draggedFrameId) {
      return;
    }

    if (dropTargetFrameId && dropTargetFrameId !== draggedFrameId) {
      reorderStoryboardFrame(nodeId, draggedFrameId, dropTargetFrameId);
    }

    setDraggedFrameId(null);
    setDropTargetFrameId(null);
  }, [draggedFrameId, dropTargetFrameId, nodeId, reorderStoryboardFrame]);

  useEffect(() => {
    if (!draggedFrameId) {
      return;
    }

    const handlePointerUp = () => {
      finalizeSort();
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [draggedFrameId, finalizeSort]);

  return {
    draggedFrameId,
    dropTargetFrameId,
    handleSortStart,
    handleSortHover,
  };
}
