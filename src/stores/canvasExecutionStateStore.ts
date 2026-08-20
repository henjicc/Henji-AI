import { create } from 'zustand'

export type CanvasNodeExecutionPhase = 'processing' | 'generating'

export interface ActiveCanvasNodeExecution {
  runId: string
  phase: CanvasNodeExecutionPhase
}

interface CanvasExecutionState {
  activeNodes: Record<string, ActiveCanvasNodeExecution>
  beginNodeExecution: (nodeId: string, execution: ActiveCanvasNodeExecution) => void
  endNodeExecution: (nodeId: string, runId: string) => void
  resetNodeExecutions: () => void
}

/**
 * 画布节点执行状态的瞬态真相源。
 *
 * 状态由统一执行协调器维护，不写入项目数据与撤销历史。按 runId 清理可以避免旧任务
 * 的迟到收尾误删同一节点的新运行状态；节点组件只订阅自己的条目，不会连带刷新整张画布。
 */
export const useCanvasExecutionStateStore = create<CanvasExecutionState>((set) => ({
  activeNodes: {},

  beginNodeExecution: (nodeId, execution) => {
    set((state) => {
      const current = state.activeNodes[nodeId]
      if (current?.runId === execution.runId && current.phase === execution.phase) return state
      return { activeNodes: { ...state.activeNodes, [nodeId]: execution } }
    })
  },

  endNodeExecution: (nodeId, runId) => {
    set((state) => {
      if (state.activeNodes[nodeId]?.runId !== runId) return state
      const next = { ...state.activeNodes }
      delete next[nodeId]
      return { activeNodes: next }
    })
  },

  resetNodeExecutions: () => {
    set((state) => Object.keys(state.activeNodes).length === 0
      ? state
      : { activeNodes: {} })
  },
}))
