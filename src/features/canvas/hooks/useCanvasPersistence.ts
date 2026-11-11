import { useCallback, useEffect, useRef } from 'react';
import { useStoreApi, type ReactFlowInstance, type ReactFlowState, type Viewport } from '@xyflow/react';

import { isUiInspectionReadOnly } from '@/platform/runtime';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { findCanvasProjectInstance } from '@/features/canvas/application/canvasProjectInstances';
import { CANVAS_FIT_VIEW_OPTIONS } from '@/features/canvas/canvasUtils';

/** 节点量出尺寸前最多等这么多帧再判断视野（量不出就按位置估） */
const MEASURE_WAIT_FRAMES = 30;

/**
 * 按这个视口看，节点是不是大半都看得见：全部节点的外框与视口相交的面积，占“外框与视口中较小者”的一半以上。
 * 放大在局部干活时节点铺满视口，算看得见；视野停在别处、换了窗口大小把节点挤到角落，算看不见。
 * 没有节点或画布还没量出尺寸时算看得见（不用对准）。
 */
export function nodesMostlyInView(state: ReactFlowState<CanvasNode, CanvasEdge>, viewport: Viewport): boolean {
  if (state.width <= 0 || state.height <= 0) return true;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of state.nodeLookup.values()) {
    if (node.hidden) continue;
    const { x, y } = node.internals.positionAbsolute;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + Math.max(1, node.measured.width ?? node.width ?? 0));
    maxY = Math.max(maxY, y + Math.max(1, node.measured.height ?? node.height ?? 0));
  }
  if (minX === Infinity) return true;
  const left = -viewport.x / viewport.zoom;
  const top = -viewport.y / viewport.zoom;
  const right = left + state.width / viewport.zoom;
  const bottom = top + state.height / viewport.zoom;
  const overlap = Math.max(0, Math.min(maxX, right) - Math.max(minX, left)) * Math.max(0, Math.min(maxY, bottom) - Math.max(minY, top));
  const reference = Math.min((maxX - minX) * (maxY - minY), (right - left) * (bottom - top));
  return overlap >= reference / 2;
}

/**
 * 画布页与文档会话的衔接（3.4）：
 * - 节点、连线的自动保存由画布实例接到文档会话完成（防抖、只在有变化时写，拖动松手后才标脏）；
 *   这里的 schedulePersist(0) 只是“尽快写完”，其他延迟交给会话的防抖。
 * - 打开画布时把实例里恢复的视口应用到 ReactFlow；按它大半节点都在视野外（视野停在别处、窗口换了大小）
 *   就改为对准全部节点。离开画布页时把手势最后的位置同步回 store，由实例写进程序目录的会话状态。
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
    // 恢复的视口应用到 ReactFlow 之前，ReactFlow 里还是默认视口；这期间卸载（或效果重跑）不能把它同步回 store，
    // 否则恢复出来的视口会被默认值覆盖
    let applied = false;
    let frame = 0;
    // 节点量出尺寸后再看恢复的视野：大半节点都在视野外就对准全部节点
    const checkView = (restored: Viewport, framesLeft: number): void => {
      const state = flowStore.getState();
      const measured = Array.from(state.nodeLookup.values()).every((node) => node.hidden || node.measured.width);
      if (!measured && framesLeft > 0) {
        frame = requestAnimationFrame(() => checkView(restored, framesLeft - 1));
        return;
      }
      // 等尺寸的这几帧里视野已被动过（用户平移缩放、助手定位节点）就不再改；读实时视口，受控视口的 transform 会晚一拍
      const live = state.panZoom?.getViewport();
      if (live && (live.x !== restored.x || live.y !== restored.y || live.zoom !== restored.zoom)) return;
      if (!nodesMostlyInView(state, restored)) void reactFlow.fitView(CANVAS_FIT_VIEW_OPTIONS);
    };
    frame = requestAnimationFrame(() => {
      if (currentProjectId && useProjectStore.getState().currentProjectId === currentProjectId) {
        applied = true;
        const restored = useCanvasStore.getState().currentViewport;
        void reactFlow.setViewport(restored, { duration: 0 });
        checkView(restored, MEASURE_WAIT_FRAMES);
      }
    });
    const restoreTimer = setTimeout(() => { isRestoringRef.current = false; }, 0);
    return () => {
      clearTimeout(restoreTimer);
      cancelAnimationFrame(frame);
      // 视口呈现按帧合并；切页 / 卸载可能发生在下一帧之前，把手势的最新位置同步回 store。
      const viewport = applied ? flowStore.getState().panZoom?.getViewport() : undefined;
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
