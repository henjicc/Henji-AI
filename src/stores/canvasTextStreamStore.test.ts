import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCanvasTextStreamStore } from './canvasTextStreamStore'

describe('canvasTextStreamStore', () => {
  beforeEach(() => useCanvasTextStreamStore.getState().clearAllPreviews())

  it('只保存流式预览，并在内容未变化时不重复通知', () => {
    const listener = vi.fn()
    const unsubscribe = useCanvasTextStreamStore.subscribe(listener)

    useCanvasTextStreamStore.getState().setPreview('result-1', { content: '第一段', reasoning: '分析' })
    useCanvasTextStreamStore.getState().setPreview('result-1', { content: '第一段', reasoning: '分析' })

    expect(useCanvasTextStreamStore.getState().previews).toEqual({
      'result-1': { content: '第一段', reasoning: '分析' },
    })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('可以按节点和整张画布清理瞬态预览', () => {
    const store = useCanvasTextStreamStore.getState()
    store.setPreview('result-1', { content: '一', reasoning: '' })
    store.setPreview('result-2', { content: '二', reasoning: '' })
    store.clearPreviews(new Set(['result-1']))

    expect(useCanvasTextStreamStore.getState().previews).toEqual({
      'result-2': { content: '二', reasoning: '' },
    })

    useCanvasTextStreamStore.getState().clearAllPreviews()
    expect(useCanvasTextStreamStore.getState().previews).toEqual({})
  })

  it('忽略上一轮迟到的 token 和清理事件', () => {
    const store = useCanvasTextStreamStore.getState()
    store.setPreview('result-1', { content: '', reasoning: '' }, 'run-old')
    store.setPreview('result-1', { content: '', reasoning: '' }, 'run-new')
    store.setPreview('result-1', { content: '旧内容', reasoning: '旧思考' }, 'run-old')
    store.setPreview('result-1', { content: '新内容', reasoning: '新思考' }, 'run-new')
    store.setPreview('result-1', null, 'run-old')

    expect(useCanvasTextStreamStore.getState().previews).toEqual({
      'result-1': { content: '新内容', reasoning: '新思考' },
    })
    expect(useCanvasTextStreamStore.getState().runIds).toEqual({ 'result-1': 'run-new' })
  })
})
