import { describe, expect, it } from 'vitest'
import { PreviewRevisionTracker } from './previewRevisionTracker'

describe('PreviewRevisionTracker', () => {
  it('只在同一个图片编辑会话内淘汰旧 revision', () => {
    const tracker = new PreviewRevisionTracker()

    tracker.register('editor-a', 257)
    tracker.register('editor-b', 1)

    expect(tracker.isStale('editor-a', 256)).toBe(true)
    expect(tracker.isStale('editor-b', 1)).toBe(false)
  })

  it('会话空闲后释放旧上限，允许同一 scope 重新计数', () => {
    const tracker = new PreviewRevisionTracker()

    tracker.register('editor-a', 257)
    tracker.complete('editor-a')
    tracker.register('editor-a', 1)

    expect(tracker.isStale('editor-a', 1)).toBe(false)
  })

  it('同一会话有并发请求时保留最新 revision 直到全部结束', () => {
    const tracker = new PreviewRevisionTracker()

    tracker.register('editor-a', 1)
    tracker.register('editor-a', 2)
    tracker.complete('editor-a')

    expect(tracker.isStale('editor-a', 1)).toBe(true)
    expect(tracker.isStale('editor-a', 2)).toBe(false)
  })
})
