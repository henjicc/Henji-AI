import { create } from 'zustand'

interface CanvasTextStreamState {
  previews: Record<string, CanvasTextStreamPreview>
  runIds: Record<string, string>
  setPreview: (nodeId: string, preview: CanvasTextStreamPreview | null, runId?: string) => void
  clearPreviews: (nodeIds: ReadonlySet<string>) => void
  clearAllPreviews: () => void
}

export interface CanvasTextStreamPreview {
  content: string
  reasoning: string
}

/**
 * 文本流式预览的瞬态状态源。
 *
 * 这里刻意不写 canvasStore：token 到达期间只通知对应的文本结果节点，避免重建
 * ReactFlow nodes 数组、触发 minimap 和所有依赖画布节点集合的选择器。
 */
export const useCanvasTextStreamStore = create<CanvasTextStreamState>((set) => ({
  previews: {},
  runIds: {},

  setPreview: (nodeId, preview, runId) => {
    set((state) => {
      const current = state.previews[nodeId]
      const currentRunId = state.runIds[nodeId]
      const startsNewRun = preview?.content === '' && preview.reasoning === ''
      if (runId && currentRunId && currentRunId !== runId && !startsNewRun) return state
      if (preview === null) {
        if (runId && currentRunId && currentRunId !== runId) return state
        if (current === undefined) return state
        const next = { ...state.previews }
        const nextRunIds = { ...state.runIds }
        delete next[nodeId]
        delete nextRunIds[nodeId]
        return { previews: next, runIds: nextRunIds }
      }
      if (
        current?.content === preview.content
        && current.reasoning === preview.reasoning
        && (!runId || currentRunId === runId)
      ) return state
      return {
        previews: { ...state.previews, [nodeId]: preview },
        runIds: runId ? { ...state.runIds, [nodeId]: runId } : state.runIds,
      }
    })
  },

  clearPreviews: (nodeIds) => {
    set((state) => {
      const hitKeys = Object.keys(state.previews).filter((nodeId) => nodeIds.has(nodeId))
      if (hitKeys.length === 0) return state
      const next = { ...state.previews }
      const nextRunIds = { ...state.runIds }
      for (const nodeId of hitKeys) delete next[nodeId]
      for (const nodeId of hitKeys) delete nextRunIds[nodeId]
      return { previews: next, runIds: nextRunIds }
    })
  },

  clearAllPreviews: () => {
    set((state) => (Object.keys(state.previews).length === 0
      ? state
      : { previews: {}, runIds: {} }))
  },
}))
