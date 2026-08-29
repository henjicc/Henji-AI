import { describe, expect, it, vi } from 'vitest'

import { continuePolling, execute } from '../../src/providers/fal'
import { fakeRuntimeContext } from './test-helpers'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Fal provider', () => {
  it('队列 REST 请求直接发送模型输入，不包装 SDK 专用 input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      request_id: 'fal-request-1',
      status_url: 'https://queue.fal.run/example/requests/fal-request-1/status',
    }))

    await expect(execute({
      apiKey: 'fal-secret',
      route: '/fal-ai/example',
      method: 'POST',
      body: { prompt: 'cat', image_url: 'https://example.com/input.png' },
      requestId: 'local-request-1',
      runtime: fakeRuntimeContext(fetchMock),
    })).resolves.toMatchObject({
      status: 'pending',
      taskId: 'https://queue.fal.run/example/requests/fal-request-1/status',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://queue.fal.run/fal-ai/example',
      expect.objectContaining({
        body: JSON.stringify({ prompt: 'cat', image_url: 'https://example.com/input.png' }),
      })
    )
  })

  it('队列请求保留模型级 sync_mode=false，便于强制返回 CDN URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      request_id: 'fal-request-async-output',
      status_url: 'https://queue.fal.run/example/requests/fal-request-async-output/status',
    }))

    await expect(execute({
      apiKey: 'fal-secret',
      route: '/pixelcut/background-removal',
      method: 'POST',
      body: { image_url: 'https://example.com/input.png', sync_mode: false },
      requestId: 'local-request-async-output',
      runtime: fakeRuntimeContext(fetchMock),
    })).resolves.toMatchObject({ status: 'pending' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://queue.fal.run/pixelcut/background-removal',
      expect.objectContaining({
        body: JSON.stringify({ image_url: 'https://example.com/input.png', sync_mode: false }),
      })
    )
  })

  it('同步 REST 请求移除本地 sync_mode 后直接发送模型输入', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      images: [{ url: 'https://example.com/output.png' }],
    }))

    await expect(execute({
      apiKey: 'fal-secret',
      route: '/fal-ai/example',
      method: 'POST',
      body: { prompt: 'cat', sync_mode: true },
      requestId: 'local-request-2',
      runtime: fakeRuntimeContext(fetchMock),
    })).resolves.toMatchObject({ status: 'completed', url: 'https://example.com/output.png' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://fal.run/fal-ai/example',
      expect.objectContaining({ body: JSON.stringify({ prompt: 'cat' }) })
    )
  })

  it('拒绝队列提交响应中伪造的跨域 status_url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      request_id: 'fal-request-untrusted-submit',
      status_url: 'https://evil.example/collect-fal-key',
    }))

    await expect(execute({
      apiKey: 'fal-secret',
      route: '/fal-ai/example',
      method: 'POST',
      body: { prompt: 'cat' },
      requestId: 'local-submit-untrusted-status',
      runtime: fakeRuntimeContext(fetchMock),
    })).rejects.toMatchObject({ code: 'invalid_endpoint' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('COMPLETED 中携带 error 时按任务失败处理，不误取结果', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      status: 'COMPLETED',
      request_id: 'fal-request-failed',
      error: 'content policy violation',
      error_type: 'UserError',
    }))

    await expect(continuePolling({
      apiKey: 'fal-secret',
      route: '/fal-ai/example',
      taskId: 'fal-request-failed',
      requestId: 'local-poll-1',
      polling: { interval: 0, maxAttempts: 1 },
      runtime: fakeRuntimeContext(fetchMock),
    })).rejects.toMatchObject({
      code: 'provider_task_failed',
      message: expect.stringContaining('content policy violation'),
    })
  })

  it('状态完成后按 response_url 获取模型结果', async () => {
    const statusUrl = 'https://queue.fal.run/server-canonical/requests/fal-request-2/status'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'COMPLETED',
        request_id: 'fal-request-2',
        response_url: 'https://queue.fal.run/example/requests/fal-request-2/response',
      }))
      .mockResolvedValueOnce(jsonResponse({ video: { url: 'https://example.com/output.mp4' } }))

    await expect(continuePolling({
      apiKey: 'fal-secret',
      route: '/fal-ai/example',
      taskId: statusUrl,
      requestId: 'local-poll-2',
      polling: { interval: 0, maxAttempts: 1 },
      runtime: fakeRuntimeContext(fetchMock),
    })).resolves.toMatchObject({
      status: 'completed',
      url: 'https://example.com/output.mp4',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(1, statusUrl, expect.any(Object))
  })

  it('拒绝向非 Fal 队列域名发送续查凭据', async () => {
    const fetchMock = vi.fn()

    await expect(continuePolling({
      apiKey: 'fal-secret',
      route: '/fal-ai/example',
      taskId: 'https://queue.fal.run.evil.example/requests/stolen/status',
      requestId: 'local-poll-untrusted-status',
      polling: { interval: 0, maxAttempts: 1 },
      runtime: fakeRuntimeContext(fetchMock),
    })).rejects.toMatchObject({ code: 'invalid_endpoint' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('拒绝 COMPLETED 状态中的跨域 response_url', async () => {
    const statusUrl = 'https://queue.fal.run/fal-ai/example/requests/fal-request-untrusted-response/status'
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      status: 'COMPLETED',
      request_id: 'fal-request-untrusted-response',
      response_url: 'https://evil.example/collect-fal-key',
    }))

    await expect(continuePolling({
      apiKey: 'fal-secret',
      route: '/fal-ai/example',
      taskId: statusUrl,
      requestId: 'local-poll-untrusted-response',
      polling: { interval: 0, maxAttempts: 1 },
      runtime: fakeRuntimeContext(fetchMock),
    })).rejects.toMatchObject({ code: 'invalid_endpoint' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
