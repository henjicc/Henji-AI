import { createTransientProgressStore } from './createTransientProgressStore';

/**
 * 生成工作区任务进度的独立瞬态状态源（taskId -> 0~100）。
 *
 * 刻意不合进 useTaskState 的 tasks 数组：生成期间进度回调最快每次轮询写一次，
 * 若走 setTasks((prev) => prev.map(...)) 会重建整个 tasks 数组，导致 GenerationWorkspace
 * 根组件重渲染、所有基于 tasks 的 useMemo（过滤/排序/分组）全部重跑、TaskList 重建子元素。
 * 这一轮宽重渲染会和拖拽智能助手窗口的 pointermove 抢主线程，表现为拖动掉帧、"慢半拍"。
 *
 * 拆成独立 store 后，进度通知面收敛到真正显示进度条的那个 TaskCard 叶子（自订阅），
 * 与画布的 canvasGenerationProgressStore 同一套治理思路。
 *
 * 瞬态状态：不进任务历史快照、不参与持久化。
 */
interface GenerationTaskProgressState {
  /** taskId -> 0~100 */
  progress: Record<string, number>;
  /** 设置某个任务的进度（0~100），传 null 表示清除该任务的进度 */
  setProgress: (taskId: string, progress: number | null) => void;
  /** 清除单个任务的进度（任务删除/结束时调用，避免内存泄漏） */
  clearProgress: (taskId: string) => void;
  /** 清空全部进度（清空历史时调用） */
  clearAllProgress: () => void;
}

const progressStore = createTransientProgressStore<number, GenerationTaskProgressState>({
  initialState: actions => ({ progress: {}, setProgress: actions.set, clearProgress: id => actions.clear([id]), clearAllProgress: actions.clearAll }),
  getEntry: (state, id) => state.progress[id],
  entries: state => Object.entries(state.progress),
  patch: entries => ({ progress: Object.fromEntries(entries) }),
  normalize: progress => Math.min(100, Math.max(0, progress)),
  equals: (current, next) => Math.abs(current - next) < 0.5,
});
export const useGenerationTaskProgressStore = progressStore.store;
