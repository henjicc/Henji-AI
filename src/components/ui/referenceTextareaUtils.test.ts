import { describe, expect, it, vi } from 'vitest'

import {
  captureTextareaView,
  restoreTextareaView,
} from './referenceTextareaUtils'

describe('ReferenceTextarea 视口保持', () => {
  it('捕获当前横纵滚动位置', () => {
    expect(captureTextareaView({ scrollTop: 320, scrollLeft: 18 })).toEqual({
      scrollTop: 320,
      scrollLeft: 18,
    })
  })

  it('恢复光标时禁止浏览器自动滚动并还原原视口', () => {
    const calls: string[] = []
    const textarea = {
      scrollTop: 0,
      scrollLeft: 0,
      focus: vi.fn((options?: FocusOptions) => {
        calls.push(`focus:${String(options?.preventScroll)}`)
        textarea.scrollTop = 999
      }),
      setSelectionRange: vi.fn((start: number, end: number) => {
        calls.push(`selection:${start}:${end}`)
      }),
    }

    restoreTextareaView(textarea, 42, { scrollTop: 320, scrollLeft: 18 })

    expect(calls).toEqual(['focus:true', 'selection:42:42'])
    expect(textarea.scrollTop).toBe(320)
    expect(textarea.scrollLeft).toBe(18)
  })
})
