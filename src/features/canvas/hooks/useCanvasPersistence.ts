import { useCallback, useEffect, useRef } from 'react';
import { useStoreApi, type ReactFlowInstance } from '@xyflow/react';

import { isUiInspectionReadOnly } from '@/platform/runtime';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { findCanvasProjectInstance } from '@/features/canvas/application/canvasProjectInstances';

/**
 * 画布页与文档会话的衔接（3.4）：
 * - 节点、连线的自动保存由画布实例接到文档会话完成（防抖、只在有变化时写，拖动松手后才标脏）；
 *   这里的 schedulePersist(0) 只是“尽快写完”，其他延迟交给会话的防抖。
 * - 打开画布时把实例里恢复的视口应用到 ReactFlow；离开画布页时把手势最后的位置同步回 store，
 *   由实例写进程序目录的会话状态。
 */
export function useCanvasPersistence(
  wrapperRef: React.RefObject<HTMLDivElement>,
  reactFlow: ReactFlowInstance<CanvasNode, CanvasEdge>,
) {
  const flowStore = useStoreApi<CanvasNode, CanvasEdge>();
  const setCanvasViewportSize = useCanvasStore((state) => state.setCanvasViewportSize);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const inspectionReadOnly = isUiInspectionReadOnly();
  const isRestoringRef = useRef(true);

  const schedulePersist = useCallback((delayMs?: number) => {
    if (inspectionReadOnly || delayMs !== 0 || !currentProjectId) return;
    const instance = findCanvasProjectInstance(currentProjectId);
    if (instance) void instance.session.flush().catch(() => undefined);
  }, [currentProjectId, inspectionReadOnly]);

  useEffect(() => {
    isRestoringRef.current = true;
    const frame = requestAnimationFrame(() => {
      if (currentProjectId && useProjectStore.getState().currentProjectId === currentProjectId) {
        void reactFlow.setViewport(useCanvasStore.getState().currentViewport, { duration: 0 });
      }
    });
    const restoreTimer = setTimeout(() => { isRestoringRef.current = false; }, 0);
    return () => {
      clearTimeout(restoreTimer);
      cancelAnimationFrame(frame);
      // 视口呈现按帧合并；切页 / 卸载可能发生在下一帧之前，把手势的最新位置同步回 store。
      const viewport = flowStore.getState().panZoom?.getViewport();
      if (viewport && currentProjectId && useProjectStore.getState().currentProjectId === currentProjectId) {
        useCanvasStore.getState().setViewportState(viewport);
      }
    };
  }, [currentProjectId, flowStore, reactFlow]);

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
