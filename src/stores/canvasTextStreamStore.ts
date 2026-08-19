import { create } from 'zustand'

interface CanvasTextStreamState {
  previews: Record<string, string>
  setPreview: (nodeId: string, content: string | null) => void
  clearPreviews: (nodeIds: ReadonlySet<string>) => void
  clearAllPreviews: () => void
}

/**
 * 文本流式预览的瞬态状态源。
 *
 * 这里刻意不写 canvasStore：token 到达期间只通知对应的文本结果节点，避免重建
 * ReactFlow nodes 数组、触发 minimap 和所有依赖画布节点集合的选择器。
 */
export const useCanvasTextStreamStore = create<CanvasTextStreamState>((set) => ({
  previews: {},

  setPreview: (nodeId, content) => {
    set((state) => {
      const current = state.previews[nodeId]
      if (content === null) {
        if (current === undefined) return state
        const next = { ...state.previews }
        delete next[nodeId]
        return { previews: next }
      }
      if (current === content) return state
      return { previews: { ...state.previews, [nodeId]: content } }
    })
  },

  clearPreviews: (nodeIds) => {
    set((state) => {
      const hitKeys = Object.keys(state.previews).filter((nodeId) => nodeIds.has(nodeId))
      if (hitKeys.length === 0) return state
      const next = { ...state.previews }
      for (const nodeId of hitKeys) delete next[nodeId]
      return { previews: next }
    })
  },

  clearAllPreviews: () => {
    set((state) => (Object.keys(state.previews).length === 0 ? state : { previews: {} }))
  },
}))
