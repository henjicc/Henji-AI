import { createTransientProgressStore } from './createTransientProgressStore';

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

const progressStore = createTransientProgressStore<number, CanvasGenerationProgressState>({
  initialState: actions => ({ progress: {}, setProgress: actions.set, clearProgress: actions.clear, clearAllProgress: actions.clearAll }),
  getEntry: (state, id) => state.progress[id],
  entries: state => Object.entries(state.progress),
  patch: entries => ({ progress: Object.fromEntries(entries) }),
  normalize: progress => Math.min(1, Math.max(0, progress)),
  equals: (current, next) => Math.abs(current - next) < 0.001,
});
export const useCanvasGenerationProgressStore = progressStore.store;
