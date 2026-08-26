import { useEffect, useRef, type RefObject } from 'react';
import { create } from 'zustand';

/**
 * 节点内子元素（提示词、参数输入框等）获得焦点时，应视为该节点被激活——
 * 与"点击节点空白区域"等价，但不复用 React Flow 原生 `node.selected`：
 * 大量输入控件标了 `nodrag` 以避免拖拽/输入手势冲突，而 `nodrag` 会让 XYDrag
 * 跳过其内置的"按下即选中"逻辑，导致原生 selected 永远不会因为聚焦输入框而置真。
 * 这里独立跟踪 focus，只喂给 useCanvasShortcuts.ts 的选中态同步（驱动顶部工具栏）。
 *
 * 不要把这份 focus 状态覆盖回节点组件的 `selected` prop：提示词编辑器等组件把
 * `selected` 当成"是否允许进入编辑态"的行为开关，而不仅是边框样式。静态展示态
 * 激活为可编辑态时会卸载旧的展示节点、挂载新的编辑器（甚至懒加载），中间有一帧
 * 焦点真空——若这份 focus 状态直接决定 `selected`，编辑器自身"取消选中即退出编辑"
 * 的效果会在这一帧里把刚激活的编辑态立刻撤销，导致点一下提示词框完全无法进入编辑。
 */
interface CanvasNodeFocusState {
  focusedNodeId: string | null;
  setFocusedNodeId: (nodeId: string | null) => void;
}

/**
 * 导出是为了让 `canvasNodeFocusStoreLedger.ts` 的覆盖门禁能从运行时枚举出动作名——
 * 那道门禁按内容识别 zustand store，账本对不上就红。组件请用下面两个 hook，不要直接订阅。
 */
export const useCanvasNodeFocusStore = create<CanvasNodeFocusState>((set) => ({
  focusedNodeId: null,
  setFocusedNodeId: (nodeId) => set((state) => (state.focusedNodeId === nodeId ? state : { focusedNodeId: nodeId })),
}));

function resolveFocusedNodeId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest('.react-flow__node')?.getAttribute('data-id') ?? null;
}

export function useCanvasNodeFocusTracking(wrapperRef: RefObject<HTMLElement>): void {
  const setFocusedNodeId = useCanvasNodeFocusStore((state) => state.setFocusedNodeId);
  const pendingFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const cancelPendingCheck = (): void => {
      if (pendingFrameRef.current !== null) {
        cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
      }
    };
    const handleFocusIn = (event: FocusEvent): void => {
      cancelPendingCheck();
      setFocusedNodeId(resolveFocusedNodeId(event.target));
    };
    const handleFocusOut = (): void => {
      // relatedTarget 在"静态展示切换为可编辑态"这类同步卸载重挂载场景里普遍是 null
      // （旧节点先失焦，新控件还没来得及自己 focus）。延后一帧用 activeElement 复核，
      // 给新控件一个自己拿到焦点的机会，避免把"仍在同一节点内切换焦点"误判为焦点已离开。
      cancelPendingCheck();
      pendingFrameRef.current = requestAnimationFrame(() => {
        pendingFrameRef.current = null;
        const active = wrapper.ownerDocument.activeElement;
        setFocusedNodeId(wrapper.contains(active) ? resolveFocusedNodeId(active) : null);
      });
    };
    wrapper.addEventListener('focusin', handleFocusIn);
    wrapper.addEventListener('focusout', handleFocusOut);
    return () => {
      cancelPendingCheck();
      wrapper.removeEventListener('focusin', handleFocusIn);
      wrapper.removeEventListener('focusout', handleFocusOut);
    };
  }, [wrapperRef, setFocusedNodeId]);
}

export function useFocusedCanvasNodeId(): string | null {
  return useCanvasNodeFocusStore((state) => state.focusedNodeId);
}
