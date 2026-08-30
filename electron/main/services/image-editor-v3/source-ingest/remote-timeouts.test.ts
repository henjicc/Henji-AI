import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createRemoteDeadlineSignal,
  streamRemoteResponseChunks,
} from './remote-timeouts'

describe('V3 remote source timeout lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('远程总预算在正常完成时可显式释放，不会留下定时器', () => {
    vi.useFakeTimers()
    const deadline = createRemoteDeadlineSignal(undefined, 1_000)

    expect(vi.getTimerCount()).toBe(1)
    deadline.dispose()
    expect(vi.getTimerCount()).toBe(0)

    vi.advanceTimersByTime(1_000)
    expect(deadline.signal.aborted).toBe(false)
  })

  it('响应体每次读取完成后都会清理对应的 idle 定时器', async () => {
    vi.useFakeTimers()
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3]))
        controller.close()
      },
    }))
    const chunks: number[][] = []

    for await (const chunk of streamRemoteResponseChunks(response, 8, 100)) {
      chunks.push([...chunk])
    }

    expect(chunks).toEqual([[1, 2], [3]])
    expect(vi.getTimerCount()).toBe(0)
  })
})
