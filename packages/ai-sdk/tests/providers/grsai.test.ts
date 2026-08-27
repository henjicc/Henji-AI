import { afterEach, describe, expect, it, vi } from 'vitest'

import { continuePolling, execute } from '../../src/providers/grsai'
import { resetGrsaiEndpointPreference } from '../../src/providers/endpoints/grsai'
import { fakeRuntimeContext } from './test-helpers'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Grsai provider', () => {
  afterEach(() => {
    resetGrsaiEndpointPreference()
  })

  it('提交任务时附带鉴权，且无论 builder 填了什么都强制 replyType=async', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'task-1', status: 'running' }))

    await expect(execute({
      apiKey: 'secret',
      route: '/v1/api/generate',
      method: 'POST',
      body: { model: 'nano-banana-2', prompt: 'cat', replyType: 'json' },
      requestId: 'request-1',
      runtime: fakeRuntimeContext(fetchMock),
    })).resolves.toMatchObject({ status: 'pending', taskId: 'task-1' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://grsaiapi.com/v1/api/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      })
    )
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(requestBody).toMatchObject({ model: 'nano-banana-2', prompt: 'cat', replyType: 'async' })
  })

  it('提交即返回最终结果时直接标记为 completed，不用再轮询', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: 'task-sync',
      status: 'succeeded',
      results: [{ url: 'https://file1.aitohumanize.com/a.png' }],
    }))

    await expect(execute({
      apiKey: 'secret', route: '/v1/api/generate', method: 'POST', body: {}, requestId: 'request-2',
      runtime: fakeRuntimeContext(fetchMock),
    })).resolves.toMatchObject({
      status: 'completed',
      url: 'https://file1.aitohumanize.com/a.png',
    })
  })

  it('轮询成功后读取 results 数组里的多个 URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: 'task-3',
      status: 'succeeded',
      results: [{ url: 'https://example.com/a.png' }, { url: 'https://example.com/b.png' }],
    }))

    await expect(continuePolling({
      apiKey: 'secret', route: '/v1/api/generate', taskId: 'task-3', requestId: 'poll-1',
      polling: { interval: 0, maxAttempts: 1 },
      runtime: fakeRuntimeContext(fetchMock),
    })).resolves.toMatchObject({
      status: 'completed',
      url: 'https://example.com/a.png|||https://example.com/b.png',
    })
  })

  it('轮询查询走 GET /v1/api/result?id=', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: 'task-4', status: 'succeeded', results: [{ url: 'https://example.com/a.png' }],
    }))

    await continuePolling({
      apiKey: 'secret', route: '/v1/api/generate', taskId: 'task-4', requestId: 'poll-2',
      polling: { interval: 0, maxAttempts: 1 },
      runtime: fakeRuntimeContext(fetchMock),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://grsaiapi.com/v1/api/result?id=task-4',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret' }) })
    )
  })

  it('running 状态继续轮询，直到 succeeded', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'task-5', status: 'running', progress: 20 }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'task-5', status: 'succeeded', results: [{ url: 'https://example.com/a.png' }],
      }))

    await expect(continuePolling({
      apiKey: 'secret', route: '/v1/api/generate', taskId: 'task-5', requestId: 'poll-3',
      polling: { interval: 0, maxAttempts: 5 },
      runtime: fakeRuntimeContext(fetchMock),
    })).resolves.toMatchObject({ status: 'completed' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('failed 状态透传错误信息', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: 'task-6', status: 'failed', error: 'generate failed',
    }))

    await expect(continuePolling({
      apiKey: 'secret', route: '/v1/api/generate', taskId: 'task-6', requestId: 'poll-4',
      polling: { interval: 0, maxAttempts: 1 },
      runtime: fakeRuntimeContext(fetchMock),
    })).rejects.toMatchObject({
      code: 'provider_task_failed',
      message: expect.stringContaining('generate failed'),
    })
  })

  it('violation 是独立于 failed 的终态，同样直接终止并透传信息', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: 'task-7', status: 'violation', error: 'content policy',
    }))

    await expect(continuePolling({
      apiKey: 'secret', route: '/v1/api/generate', taskId: 'task-7', requestId: 'poll-5',
      polling: { interval: 0, maxAttempts: 1 },
      runtime: fakeRuntimeContext(fetchMock),
    })).rejects.toMatchObject({
      code: 'provider_task_failed',
      message: expect.stringContaining('content policy'),
    })
  })

  it('全球节点不可达时切换到国内直连节点', async () => {
    const networkError = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('unreachable'), { code: 'ENETUNREACH' }),
    })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(jsonResponse({ id: 'task-cn', status: 'running' }))

    await expect(execute({
      apiKey: 'secret', route: '/v1/api/generate', method: 'POST', body: {}, requestId: 'request-cn',
      runtime: fakeRuntimeContext(fetchMock),
    })).resolves.toMatchObject({ status: 'pending', taskId: 'task-cn' })

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://grsaiapi.com/v1/api/generate',
      'https://grsai.dakka.com.cn/v1/api/generate',
    ])
  })
})
