import { afterEach, describe, expect, it, vi } from 'vitest'

import { continuePolling, execute } from './fal'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Fal provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('队列 REST 请求直接发送模型输入，不包装 SDK 专用 input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      request_id: 'fal-request-1',
      status_url: 'https://queue.fal.run/example/requests/fal-request-1/status',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(execute({
      apiKey: 'fal-secret',
      route: '/fal-ai/example',
      method: 'POST',
      body: { prompt: 'cat', image_url: 'https://example.com/input.png' },
      requestId: 'local-request-1',
    })).resolves.toMatchObject({ status: 'pending', taskId: 'fal-request-1' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://queue.fal.run/fal-ai/example',
      expect.objectContaining({
        body: JSON.stringify({ prompt: 'cat', image_url: 'https://example.com/input.png' }),
      })
    )
  })

  it('同步 REST 请求移除本地 sync_mode 后直接发送模型输入', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      images: [{ url: 'https://example.com/output.png' }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(execute({
      apiKey: 'fal-secret',
      route: '/fal-ai/example',
      method: 'POST',
      body: { prompt: 'cat', sync_mode: true },
      requestId: 'local-request-2',
    })).resolves.toMatchObject({ status: 'completed', url: 'https://example.com/output.png' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://fal.run/fal-ai/example',
      expect.objectContaining({ body: JSON.stringify({ prompt: 'cat' }) })
    )
  })

  it('COMPLETED 中携带 error 时按任务失败处理，不误取结果', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      status: 'COMPLETED',
      request_id: 'fal-request-failed',
      error: 'content policy violation',
      error_type: 'UserError',
    })))

    await expect(continuePolling({
      apiKey: 'fal-secret',
      route: '/fal-ai/example',
      taskId: 'fal-request-failed',
      requestId: 'local-poll-1',
      polling: { interval: 0, maxAttempts: 1 },
    })).rejects.toMatchObject({
      code: 'provider_task_failed',
      message: expect.stringContaining('content policy violation'),
    })
  })

  it('状态完成后按 response_url 获取模型结果', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'COMPLETED',
        request_id: 'fal-request-2',
        response_url: 'https://queue.fal.run/example/requests/fal-request-2/response',
      }))
      .mockResolvedValueOnce(jsonResponse({ video: { url: 'https://example.com/output.mp4' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(continuePolling({
      apiKey: 'fal-secret',
      route: '/fal-ai/example',
      taskId: 'fal-request-2',
      requestId: 'local-poll-2',
      polling: { interval: 0, maxAttempts: 1 },
    })).resolves.toMatchObject({
      status: 'completed',
      url: 'https://example.com/output.mp4',
    })
  })
})
