import { afterEach, describe, expect, it, vi } from 'vitest'
import { continuePolling, execute } from '../../src/providers/kie'
import { shouldRetry } from '../../src/runtime/retry'
import type { ProviderContinuePollingInput } from '../../src/types/runtime'
import success from '../fixtures/kie/poll-success.json'
import { fakeRuntimeContext } from './test-helpers'

// 依据官方字段表构造：code/msg；2026-10-13
// https://docs.kie.ai/cn/market/common/get-task-detail
// 403/404 是 synthetic-negative 边界，官方查询表没有定义 404 的终态语义。
function input(fetch: ReturnType<typeof vi.fn>): ProviderContinuePollingInput {
  return { apiKey: 'fixture-key', requestId: 'kie-query-regression', taskId: 'fixture-task', polling: { interval: 1 }, runtime: fakeRuntimeContext(fetch) }
}
afterEach(() => vi.useRealTimers())

describe('KIE 查询错误分类', () => {
  it.each([
    [200, 401], [200, 403], [401, 401], [403, 403],
  ])('HTTP %s / code %s 鉴权错误仅查询一次', async (status, code) => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ code, msg: 'key revoked' }), { status })))
    const result = continuePolling(input(fetch)).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    const error = await result
    expect(error).toMatchObject({ details: { retryable: false, category: 'authentication', providerCode: String(code), providerMessage: 'key revoked', status } })
    expect(shouldRetry(error, 'poll-query')).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403])('非 JSON HTTP %s 鉴权错误也不继续轮询', async status => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('Forbidden', { status })))
    const result = continuePolling(input(fetch)).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ details: { retryable: false, category: 'authentication', status } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([404, 500])('可重试 code %s 的最后错误保留供应商原因', async code => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ code, msg: 'task lookup unavailable' }))))
    const result = continuePolling(input(fetch)).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ code: 'provider_task_unreachable', message: expect.stringContaining(`KIE recordInfo code=${code}: task lookup unavailable`) })
    expect(fetch).toHaveBeenCalledTimes(20)
  })

  it('查询失败后恢复官方 success fixture，不创建新任务', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 500, msg: 'temporary error' })))
      .mockResolvedValueOnce(new Response(JSON.stringify(success.response)))
    const result = continuePolling(input(fetch))
    await vi.runAllTimersAsync()
    await expect(result).resolves.toMatchObject({ status: 'completed', url: success.expected.url })
    expect(fetch.mock.calls.every(([url]) => String(url).includes('/recordInfo?taskId='))).toBe(true)
  })

  it('创建任务的业务鉴权错误也不可重试', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 401, msg: 'key revoked' })))
    await expect(execute({ ...input(fetch), route: '/api/v1/jobs/createTask', method: 'POST', body: { model: 'fixture', input: {} } })).rejects.toMatchObject({ details: { category: 'authentication', retryable: false, providerMessage: 'key revoked' } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
