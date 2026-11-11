import { create } from 'zustand'
import type { GenerationTask, MediaType } from '../types'

/** 一个可选的生成结果：一条记录里的第几个输出。 */
export interface SelectableResult {
  key: string
  taskId: string
  outputIndex: number
  mediaType: MediaType
  filePath: string
  /** 这条记录在列表里显示了几个结果（含没存到本机、不能选的），删除整条记录前用它判断是否全选。 */
  shownCount: number
}

export function resultSelectionKey(taskId: string, outputIndex: number): string {
  return `${taskId}#${outputIndex}`
}

/**
 * 列表里能选的结果，按列表顺序排（Shift 连选按这个顺序）。只收已保存到本机的成功结果：
 * 图片记录逐张可选，视频与音频记录只展示第一个结果，也只选第一个。
 */
export function listSelectableResults(tasks: readonly GenerationTask[]): SelectableResult[] {
  const results: SelectableResult[] = []
  for (const task of tasks) {
    if (task.status !== 'success' || !task.result || task.resultFileMissing) continue
    const shownCount = task.result.type === 'image' ? Math.max(task.result.urls.length, task.result.filePaths.length) : 1
    const filePaths = task.result.filePaths.slice(0, shownCount)
    filePaths.forEach((filePath, outputIndex) => {
      if (filePath) results.push({ key: resultSelectionKey(task.id, outputIndex), taskId: task.id, outputIndex, mediaType: task.result!.type, filePath, shownCount })
    })
  }
  return results
}

interface ResultSelectionState {
  active: boolean
  selected: ReadonlySet<string>
  /** Shift 连选的起点：最近一次单独点选的结果。 */
  anchor: string | null
  /** 当前列表里能选的结果，按列表顺序。 */
  order: readonly string[]
  enter: () => void
  exit: () => void
  /** 单个切换；`extend` 时从起点到这一项整段设成这一项的新状态（Shift 连选）。 */
  toggle: (key: string, extend?: boolean) => void
  setMany: (keys: readonly string[], selected: boolean) => void
  /** 列表变化（筛选、删除）后同步顺序，只保留仍在列表里的选择。 */
  syncOrder: (order: readonly string[]) => void
}

export const useResultSelectionStore = create<ResultSelectionState>((set) => ({
  active: false,
  selected: new Set(),
  anchor: null,
  order: [],
  enter: () => set({ active: true }),
  exit: () => set({ active: false, selected: new Set(), anchor: null }),
  toggle: (key, extend) => set((state) => {
    const next = new Set(state.selected)
    const selecting = !next.has(key)
    const from = extend && state.anchor ? state.order.indexOf(state.anchor) : -1
    const to = state.order.indexOf(key)
    const keys = from >= 0 && to >= 0 ? state.order.slice(Math.min(from, to), Math.max(from, to) + 1) : [key]
    for (const item of keys) {
      if (selecting) next.add(item)
      else next.delete(item)
    }
    return { active: true, selected: next, anchor: key }
  }),
  setMany: (keys, selected) => set((state) => {
    const next = new Set(state.selected)
    for (const key of keys) {
      if (selected) next.add(key)
      else next.delete(key)
    }
    return { selected: next }
  }),
  syncOrder: (order) => set((state) => {
    // 生成进度更新时列表数组会换新，但可选结果没变：不写入，免得每张卡重算选择
    if (order.length === state.order.length && order.every((key, index) => key === state.order[index])) return state
    const keys = new Set(order)
    const selected = [...state.selected].every(key => keys.has(key)) ? state.selected : new Set([...state.selected].filter(key => keys.has(key)))
    return { order, selected }
  }),
}))

/** 这条记录里哪些结果被选中：返回稳定的字符串，只有本条的选择变了才触发这张卡重渲染。 */
export function useTaskSelectionSignature(taskId: string): string {
  return useResultSelectionStore((state) => {
    const prefix = `${taskId}#`
    return [...state.selected].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)).sort().join(',')
  })
}
