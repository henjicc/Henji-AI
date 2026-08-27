import { afterEach, describe, expect, it, vi } from 'vitest'

import { continuePolling, execute } from '../../src/providers/apimart'
import { resetApiMartEndpointPreference } from '../../src/providers/endpoints/apimart'
import { fakeRuntimeContext } from './test-helpers'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('APIMart provider', () => {
  afterEach(() => {
    resetApiMartEndpointPreference()
  })

  it('提交任务时附带鉴权、响应版本与幂等键', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { id: 'task-1', status: 'submitted' },
      request_id: 'trace-only-request-id',
    }, 202))

    await expect(execute({
      apiKey: 'secret',
      route: '/v1/images/generations',
      method: 'POST',
      body: { model: 'gpt-image-2', prompt: 'cat', nsfw_check: true },
      requestId: 'request-1',
      runtime: fakeRuntimeContext(fetchMock),
    })).resolves.toMatchObject({ status: 'pending', taskId: 'task-1' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.apimart.ai/v1/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
          'Idempotency-Key': 'request-1',
          'X-APIMart-Response-Version': '2026-07-27',
        }),
      })
    )
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(requestBody).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'cat',
      nsfw_check: false,
    })
  })

  it('兼容旧任务 ID，并能读取嵌套 URL 数组', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      data: [{ task_id: 'legacy-task' }],
    }, 202)).mockResolvedValueOnce(jsonResponse({
      data: {
        status: 'completed',
        result: { images: [{ url: ['https://example.com/a.png', 'https://example.com/b.png'] }] },
      },
    }))
    const runtime = fakeRuntimeContext(fetchMock)

    const created = await execute({
      apiKey: 'secret', route: '/v1/images/generations', method: 'POST', body: {}, requestId: 'request-2', runtime,
    })
    expect(created.taskId).toBe('legacy-task')

    await expect(continuePolling({
      apiKey: 'secret', route: '/v1/images/generations', taskId: 'legacy-task', requestId: 'poll-1',
      polling: { interval: 0, maxAttempts: 1 },
      runtime,
    })).resolves.toMatchObject({
      status: 'completed',
      url: 'https://example.com/a.png|||https://example.com/b.png',
    })
  })

  it('轮询失败时透传 APIMart 错误信息', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { status: 'failed', error: { message: 'unsafe prompt' } },
    }))

    await expect(continuePolling({
      apiKey: 'secret', route: '/v1/images/generations', taskId: 'task-failed', requestId: 'poll-2',
      polling: { interval: 0, maxAttempts: 1 },
      runtime: fakeRuntimeContext(fetchMock),
    })).rejects.toMatchObject({
      code: 'provider_task_failed',
      message: expect.stringContaining('unsafe prompt'),
    })
  })

  it('主域名不可达时切换到大陆备用 API 端点', async () => {
    const networkError = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('unreachable'), { code: 'ENETUNREACH' }),
    })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'task-cn', status: 'submitted' } }, 202))

    await expect(execute({
      apiKey: 'secret', route: '/v1/images/generations', method: 'POST', body: {}, requestId: 'request-cn',
      runtime: fakeRuntimeContext(fetchMock),
    })).resolves.toMatchObject({ status: 'pending', taskId: 'task-cn' })

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.apimart.ai/v1/images/generations',
      'https://api.apib.ai/v1/images/generations',
    ])
  })

  it('记住上次成功的备用域名，后续请求直接优先使用它', async () => {
    const networkError = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('unreachable'), { code: 'ENETUNREACH' }),
    })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'task-cn-1', status: 'submitted' } }, 202))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'task-cn-2', status: 'submitted' } }, 202))
    const runtime = fakeRuntimeContext(fetchMock)

    await execute({
      apiKey: 'secret', route: '/v1/images/generations', method: 'POST', body: {}, requestId: 'request-cn-1', runtime,
    })
    await execute({
      apiKey: 'secret', route: '/v1/images/generations', method: 'POST', body: {}, requestId: 'request-cn-2', runtime,
    })

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.apimart.ai/v1/images/generations',
      'https://api.apib.ai/v1/images/generations',
      'https://api.apib.ai/v1/images/generations',
    ])
  })
})
