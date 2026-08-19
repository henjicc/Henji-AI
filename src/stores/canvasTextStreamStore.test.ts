import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCanvasTextStreamStore } from './canvasTextStreamStore'

describe('canvasTextStreamStore', () => {
  beforeEach(() => useCanvasTextStreamStore.getState().clearAllPreviews())

  it('只保存流式预览，并在内容未变化时不重复通知', () => {
    const listener = vi.fn()
    const unsubscribe = useCanvasTextStreamStore.subscribe(listener)

    useCanvasTextStreamStore.getState().setPreview('result-1', '第一段')
    useCanvasTextStreamStore.getState().setPreview('result-1', '第一段')

    expect(useCanvasTextStreamStore.getState().previews).toEqual({ 'result-1': '第一段' })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('可以按节点和整张画布清理瞬态预览', () => {
    const store = useCanvasTextStreamStore.getState()
    store.setPreview('result-1', '一')
    store.setPreview('result-2', '二')
    store.clearPreviews(new Set(['result-1']))

    expect(useCanvasTextStreamStore.getState().previews).toEqual({ 'result-2': '二' })

    useCanvasTextStreamStore.getState().clearAllPreviews()
    expect(useCanvasTextStreamStore.getState().previews).toEqual({})
  })
})
