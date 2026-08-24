import { useCallback, useEffect, useRef } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';

import { isUiInspectionReadOnly } from '@/platform/runtime';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { DEFAULT_VIEWPORT } from '@/features/canvas/canvasUtils';

export function useCanvasPersistence(
  wrapperRef: React.RefObject<HTMLDivElement>,
  reactFlow: ReactFlowInstance<CanvasNode, CanvasEdge>,
) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const history = useCanvasStore((state) => state.history);
  const dragHistorySnapshot = useCanvasStore((state) => state.dragHistorySnapshot);
  const setCanvasData = useCanvasStore((state) => state.setCanvasData);
  const setViewportState = useCanvasStore((state) => state.setViewportState);
  const setCanvasViewportSize = useCanvasStore((state) => state.setCanvasViewportSize);
  const getCurrentProject = useProjectStore((state) => state.getCurrentProject);
  const saveCurrentProject = useProjectStore((state) => state.saveCurrentProject);
  const inspectionReadOnly = isUiInspectionReadOnly();
  const isRestoringRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistSnapshot = useCallback(() => {
    if (inspectionReadOnly || isRestoringRef.current || !getCurrentProject()) return;
    const canvas = useCanvasStore.getState();
    saveCurrentProject(canvas.nodes, canvas.edges, reactFlow.getViewport(), canvas.history);
  }, [getCurrentProject, inspectionReadOnly, reactFlow, saveCurrentProject]);

  const schedulePersist = useCallback((delayMs = 140) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      persistSnapshot();
    }, delayMs);
  }, [persistSnapshot]);

  useEffect(() => {
    isRestoringRef.current = true;
    const project = getCurrentProject();
    if (project) {
      setCanvasData(project.nodes, project.edges, project.history);
      setViewportState(project.viewport ?? DEFAULT_VIEWPORT);
      requestAnimationFrame(() => reactFlow.setViewport(project.viewport ?? DEFAULT_VIEWPORT, { duration: 0 }));
    } else setViewportState(DEFAULT_VIEWPORT);
    const restoreTimer = setTimeout(() => { isRestoringRef.current = false; }, 0);
    return () => {
      clearTimeout(restoreTimer);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      persistSnapshot();
    };
  }, [getCurrentProject, persistSnapshot, reactFlow, setCanvasData, setViewportState]);

  useEffect(() => {
    if (!isRestoringRef.current && !dragHistorySnapshot) schedulePersist();
  }, [dragHistorySnapshot, edges, history, nodes, schedulePersist]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setCanvasViewportSize({
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [setCanvasViewportSize, wrapperRef]);

  return { schedulePersist, isRestoringRef, inspectionReadOnly };
}
