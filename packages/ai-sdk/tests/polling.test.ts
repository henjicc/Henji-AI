import { describe, expect, it, vi } from 'vitest'

import { AiRuntimeError } from '../src/runtime/errors'
import { POLL_QUERY_FAILED, pollUntilResult, waitIntervalMs } from '../src/protocols/polling'

const fastPoll = { requestId: 'test-request', polling: { interval: 1 } }

describe('pollUntilResult', () => {
  it('每轮等待完成后移除 AbortSignal 监听器，长轮询不会累积监听器', async () => {
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')

    for (let round = 0; round < 20; round += 1) {
      await waitIntervalMs(0, controller.signal)
    }

    expect(add).toHaveBeenCalledTimes(20)
    expect(remove).toHaveBeenCalledTimes(20)
    expect(remove.mock.calls.map(([type]) => type)).toEqual(Array(20).fill('abort'))
  })

  it('abort 时清理定时器与监听器并返回统一取消错误', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const waiting = waitIntervalMs(10_000, controller.signal)

    controller.abort()

    await expect(waiting).rejects.toMatchObject({ code: 'cancelled' })
    expect(remove).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('任务长时间处理中也不放弃，直到拿到结果', async () => {
    let calls = 0
    const step = vi.fn(async () => {
      calls += 1
      // 远超旧的 180 次上限，验证"任务能跑多久"确实没有封顶
      return calls < 500 ? undefined : 'done'
    })

    await expect(pollUntilResult(fastPoll, step)).resolves.toBe('done')
    expect(calls).toBe(500)
  })

  it('服务端明确失败时立即上抛，不重试', async () => {
    const step = vi.fn(async () => {
      throw new AiRuntimeError('provider_task_failed', '内容审核未通过')
    })

    await expect(pollUntilResult(fastPoll, step)).rejects.toThrow('内容审核未通过')
    expect(step).toHaveBeenCalledTimes(1)
  })

  it('查询连续失败到上限后放弃，避免失效任务永久轮询', async () => {
    const step = vi.fn(async () => POLL_QUERY_FAILED)

    await expect(pollUntilResult(fastPoll, step)).rejects.toThrow('provider_task_unreachable')
    expect(step.mock.calls.length).toBeLessThan(50)
  })

  it('网络抖动不再丢掉整个任务：失败后继续重试并最终成功', async () => {
    let calls = 0
    const step = vi.fn(async () => {
      calls += 1
      if (calls <= 3) {
        throw new AiRuntimeError('provider_http_error', 'KIE HTTP 502')
      }
      return 'recovered'
    })

    await expect(pollUntilResult(fastPoll, step)).resolves.toBe('recovered')
  })

  it('中途成功一次会重置连续失败计数', async () => {
    let calls = 0
    const step = vi.fn(async () => {
      calls += 1
      // 失败 15 次 → 处理中(重置) → 再失败 15 次 → 成功；任一段都没到 20 次上限
      if (calls <= 15) return POLL_QUERY_FAILED
      if (calls === 16) return undefined
      if (calls <= 31) return POLL_QUERY_FAILED
      return 'done'
    })

    await expect(pollUntilResult(fastPoll, step)).resolves.toBe('done')
  })
})
