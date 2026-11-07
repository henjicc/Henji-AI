import { afterEach, describe, expect, it, vi } from 'vitest'

import * as bailian from '../../src/providers/bailian'
import * as volcengine from '../../src/providers/volcengine'
import { cancelTask, clearCancelFlag } from '../../src/runtime/task-registry'
import type { JsonValue, ProviderContinuePollingInput, ProviderExecutionInput } from '../../src/types/runtime'
import bailianCreate from '../fixtures/bailian/video-create-success.json'
import bailianSuccess from '../fixtures/bailian/video-poll-success.json'
import volcCreate from '../fixtures/volcengine/video-create-success.json'
import volcSuccess from '../fixtures/volcengine/video-poll-success.json'
import { fakeRuntimeContext } from './test-helpers'

// 事件矩阵与 fixture 来源见：
// docs/model-adaptation/Seedance-2.5/Seedance-2.5_火山引擎.md、Wan-3.0/Wan-3.0_百炼.md
// queued/running、PENDING/RUNNING 的中间态样本依据官方状态枚举构造（只改 status 字段）。

const VOLC_ROUTE = '/api/v3/contents/generations/tasks'
const BAILIAN_ROUTE = '/api/v1/services/aigc/video-generation/video-synthesis'

function json(payload: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function pollInput(fetch: ReturnType<typeof vi.fn>, route: string, taskId = 'fixture-task'): ProviderContinuePollingInput {
  return { apiKey: 'fixture-key', route, taskId, requestId: `poll-${taskId}`, polling: { interval: 1 }, runtime: fakeRuntimeContext(fetch) }
}

function execInput(fetch: ReturnType<typeof vi.fn>, route: string, body: JsonValue): ProviderExecutionInput {
  return { apiKey: 'fixture-key', route, method: 'POST', body, requestId: 'exec-fixture', runtime: fakeRuntimeContext(fetch) }
}

afterEach(() => vi.useRealTimers())

describe('火山方舟视频任务', () => {
  it('提交只发一次 POST 并返回 pending 任务', async () => {
    const fetch = vi.fn().mockResolvedValue(json(volcCreate.response))
    await expect(volcengine.execute(execInput(fetch, VOLC_ROUTE, volcCreate.params as JsonValue)))
      .resolves.toMatchObject({ status: 'pending', taskId: volcCreate.expected.taskId })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('提交响应缺任务 ID 时明确报错', async () => {
    const fetch = vi.fn().mockResolvedValue(json({}))
    await expect(volcengine.execute(execInput(fetch, VOLC_ROUTE, { model: 'm', content: [] })))
      .rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('queued → running → succeeded 迁移，查询地址拼接任务 ID', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ ...volcSuccess.response, status: 'queued', content: null }))
      .mockResolvedValueOnce(json({ ...volcSuccess.response, status: 'running', content: null }))
      .mockResolvedValueOnce(json(volcSuccess.response))
    const result = volcengine.continuePolling(pollInput(fetch, VOLC_ROUTE, 'cgt-1'))
    await vi.runAllTimersAsync()
    await expect(result).resolves.toMatchObject({ status: 'completed', url: volcSuccess.expected.url, taskId: 'cgt-1' })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.every(([url, init]) =>
      url === `https://ark.cn-beijing.volces.com${VOLC_ROUTE}/cgt-1` && (init as RequestInit).method === undefined)).toBe(true)
  })

  it('succeeded 却没有 video_url 时不当作成功', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockResolvedValue(json({ id: 'cgt-1', status: 'succeeded', content: { last_frame_url: 'https://x.example.com/a.jpeg' } }))
    const result = volcengine.continuePolling(pollInput(fetch, VOLC_ROUTE)).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ code: 'empty_result' })
  })

  it('缺 status 计入连续查询失败，20 次后放弃', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(json({ id: 'cgt-1' })))
    const result = volcengine.continuePolling(pollInput(fetch, VOLC_ROUTE)).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ code: 'provider_task_unreachable' })
    expect(fetch).toHaveBeenCalledTimes(20)
  })

  it('用户取消后停止查询', async () => {
    vi.useFakeTimers()
    const input = pollInput(vi.fn(), VOLC_ROUTE)
    const fetch = vi.fn().mockImplementation(() => {
      cancelTask('generation', input.requestId)
      return Promise.resolve(json({ id: 'cgt-1', status: 'running' }))
    })
    const result = volcengine.continuePolling({ ...input, runtime: fakeRuntimeContext(fetch) }).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ code: 'cancelled' })
    expect(fetch).toHaveBeenCalledTimes(1)
    clearCancelFlag('generation', input.requestId)
  })

  it('图片同步端点仍不支持轮询，且不发请求', async () => {
    const fetch = vi.fn()
    await expect(volcengine.continuePolling(pollInput(fetch, '/api/v3/images/generations')))
      .rejects.toMatchObject({ code: 'unsupported_provider' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('百炼异步视频任务', () => {
  it('视频提交带 X-DashScope-Async，图片同步提交不带', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(bailianCreate.response))
      .mockResolvedValueOnce(json({ output: { choices: [{ message: { content: [{ image: 'https://x.example.com/a.png' }] } }] } }))
    await expect(bailian.execute(execInput(fetch, BAILIAN_ROUTE, bailianCreate.params as JsonValue)))
      .resolves.toMatchObject({ status: 'pending', taskId: bailianCreate.expected.taskId })
    await bailian.execute(execInput(fetch, '/api/v1/services/aigc/multimodal-generation/generation', { model: 'qwen-image-3.0' }))
    const headers = fetch.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>)
    expect(headers[0]['X-DashScope-Async']).toBe('enable')
    expect(headers[1]).not.toHaveProperty('X-DashScope-Async')
  })

  it('提交即 FAILED 时不返回任务', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ output: { task_id: 't', task_status: 'FAILED', code: 'InvalidParameter', message: 'bad' } }))
    await expect(bailian.execute(execInput(fetch, BAILIAN_ROUTE, { model: 'wan3.0-video' })))
      .rejects.toMatchObject({ code: 'provider_task_failed', message: expect.stringContaining('InvalidParameter: bad') })
  })

  it('PENDING → RUNNING → SUCCEEDED 迁移，查询走 /api/v1/tasks/{id}', async () => {
    vi.useFakeTimers()
    const running = (status: string) => json({ ...bailianSuccess.response, output: { task_id: 't-1', task_status: status } })
    const fetch = vi.fn().mockResolvedValueOnce(running('PENDING')).mockResolvedValueOnce(running('RUNNING'))
      .mockResolvedValueOnce(json(bailianSuccess.response))
    const result = bailian.continuePolling(pollInput(fetch, BAILIAN_ROUTE, 't-1'))
    await vi.runAllTimersAsync()
    await expect(result).resolves.toMatchObject({ status: 'completed', url: bailianSuccess.expected.url })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(Array(3).fill('https://dashscope.aliyuncs.com/api/v1/tasks/t-1'))
  })

  it('CANCELED 是终态，只查询一次', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockResolvedValue(json({ output: { task_id: 't-1', task_status: 'CANCELED' } }))
    const result = bailian.continuePolling(pollInput(fetch, BAILIAN_ROUTE)).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ code: 'provider_task_failed' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('SUCCEEDED 却没有 video_url 时不当作成功', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockResolvedValue(json({ output: { task_id: 't-1', task_status: 'SUCCEEDED' } }))
    const result = bailian.continuePolling(pollInput(fetch, BAILIAN_ROUTE)).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ code: 'empty_result' })
  })

  it('图片同步端点仍不支持轮询', async () => {
    const fetch = vi.fn()
    await expect(bailian.continuePolling(pollInput(fetch, '/api/v1/services/aigc/multimodal-generation/generation')))
      .rejects.toMatchObject({ code: 'unsupported_provider' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
