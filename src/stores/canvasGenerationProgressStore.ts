import { create } from 'zustand';

/**
 * 画布生成进度的独立状态源（nodeId -> 0~1）。
 *
 * 刻意不放进 canvasStore：生成期间进度回调最快每 200ms 写一次，若走 canvasStore 的 set()，
 * 会把全画布订阅者（每条边的 O(节点+边) 图遍历选择器、每个生成节点的输入收集选择器）
 * 都重新跑一遍，平移/缩放手势期间表现为周期性掉帧、拖动"慢半拍"。
 * 拆成独立 store 后，通知面收敛到真正显示进度的结果节点。
 *
 * 与节点 data 无关：瞬态状态，不进历史快照、不参与持久化。
 */
interface CanvasGenerationProgressState {
  /** nodeId -> 0~1 */
  progress: Record<string, number>;
  /** 传 null 表示结束生成并移除该节点的进度 */
  setProgress: (nodeId: string, progress: number | null) => void;
  clearProgress: (nodeIds: ReadonlySet<string>) => void;
  clearAllProgress: () => void;
}

export const useCanvasGenerationProgressStore = create<CanvasGenerationProgressState>((set) => ({
  progress: {},

  setProgress: (nodeId, progress) => {
    set((state) => {
      const current = state.progress[nodeId];
      if (progress === null) {
        if (current === undefined) {
          return {};
        }
        const next = { ...state.progress };
        delete next[nodeId];
        return { progress: next };
      }

      const clamped = Math.min(1, Math.max(0, progress));
      if (current !== undefined && Math.abs(current - clamped) < 0.001) {
        return {};
      }
      return {
        progress: {
          ...state.progress,
          [nodeId]: clamped,
        },
      };
    });
  },

  clearProgress: (nodeIds) => {
    set((state) => {
      const hitKeys = Object.keys(state.progress).filter((nodeId) => nodeIds.has(nodeId));
      if (hitKeys.length === 0) {
        return {};
      }
      const next = { ...state.progress };
      for (const nodeId of hitKeys) {
        delete next[nodeId];
      }
      return { progress: next };
    });
  },

  clearAllProgress: () => {
    set((state) => (Object.keys(state.progress).length === 0 ? {} : { progress: {} }));
  },
}));
