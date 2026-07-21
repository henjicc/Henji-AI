import { beforeEach, describe, expect, it } from 'vitest'

import { CANVAS_NODE_TYPES, type TextAnnotationNodeData } from '@/features/canvas/domain/canvasNodes'

import { useCanvasStore } from './canvasStore'

function getContent(nodeId: string): string {
  const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId)
  return (node?.data as TextAnnotationNodeData | undefined)?.content ?? ''
}

describe('画布文本编辑历史分组', () => {
  beforeEach(() => {
    useCanvasStore.getState().setCanvasData([], [])
  })

  it('同一次聚焦编辑只记录一个画布快照', () => {
    const nodeId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.textAnnotation,
      { x: 0, y: 0 }
    )
    const historyGroup = `canvas-text:${nodeId}:content`
    const initialPastCount = useCanvasStore.getState().history.past.length

    useCanvasStore.getState().updateNodeData(nodeId, { content: 'a' }, { historyGroup })
    useCanvasStore.getState().updateNodeData(nodeId, { content: 'ab' }, { historyGroup })

    expect(useCanvasStore.getState().history.past).toHaveLength(initialPastCount + 1)
    expect(getContent(nodeId)).toBe('ab')

    expect(useCanvasStore.getState().undo()).toBe(true)
    expect(getContent(nodeId)).toBe('')
    expect(useCanvasStore.getState().redo()).toBe(true)
    expect(getContent(nodeId)).toBe('ab')
  })

  it('失焦结束分组后再次编辑会创建新快照', () => {
    const nodeId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.textAnnotation,
      { x: 0, y: 0 }
    )
    const historyGroup = `canvas-text:${nodeId}:content`

    useCanvasStore.getState().updateNodeData(nodeId, { content: 'first' }, { historyGroup })
    const firstPastCount = useCanvasStore.getState().history.past.length
    useCanvasStore.getState().endHistoryGroup(historyGroup)
    useCanvasStore.getState().updateNodeData(nodeId, { content: 'second' }, { historyGroup })

    expect(useCanvasStore.getState().history.past).toHaveLength(firstPastCount + 1)
  })
})
