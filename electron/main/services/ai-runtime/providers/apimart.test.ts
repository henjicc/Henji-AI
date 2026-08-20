import { afterEach, describe, expect, it, vi } from 'vitest'

import { continuePolling, execute } from './apimart'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('APIMart provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('提交任务时附带鉴权、响应版本与幂等键', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'task-1', status: 'submitted' } }, 202))
    vi.stubGlobal('fetch', fetchMock)

    await expect(execute({
      apiKey: 'secret',
      route: '/v1/images/generations',
      method: 'POST',
      body: { model: 'gpt-image-2', prompt: 'cat' },
      requestId: 'request-1',
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
    vi.stubGlobal('fetch', fetchMock)

    const created = await execute({
      apiKey: 'secret', route: '/v1/images/generations', method: 'POST', body: {}, requestId: 'request-2'
    })
    expect(created.taskId).toBe('legacy-task')

    await expect(continuePolling({
      apiKey: 'secret', route: '/v1/images/generations', taskId: 'legacy-task', requestId: 'poll-1',
      polling: { interval: 0, maxAttempts: 1 },
    })).resolves.toMatchObject({
      status: 'completed',
      url: 'https://example.com/a.png|||https://example.com/b.png',
    })
  })

  it('轮询失败时透传 APIMart 错误信息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: { status: 'failed', error: { message: 'unsafe prompt' } },
    })))

    await expect(continuePolling({
      apiKey: 'secret', route: '/v1/images/generations', taskId: 'task-failed', requestId: 'poll-2',
      polling: { interval: 0, maxAttempts: 1 },
    })).rejects.toMatchObject({
      code: 'provider_task_failed',
      message: expect.stringContaining('unsafe prompt'),
    })
  })
})
