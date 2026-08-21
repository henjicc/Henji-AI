import { afterEach, describe, expect, it, vi } from 'vitest'

import { continuePolling, execute } from './kie'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('KIE provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('按 Market 公共契约提交任务并读取 taskId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      success: true,
      data: { taskId: 'kie-task-1' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(execute({
      apiKey: 'kie-secret',
      route: '/api/v1/jobs/createTask',
      method: 'POST',
      body: { model: 'example-model', input: { prompt: 'cat' } },
      requestId: 'local-request-1',
    })).resolves.toMatchObject({ status: 'pending', taskId: 'kie-task-1' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.kie.ai/api/v1/jobs/createTask',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer kie-secret' }),
        body: JSON.stringify({ model: 'example-model', input: { prompt: 'cat' } }),
      })
    )
  })

  it('解析视频结果及可选首尾帧 URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      success: true,
      data: {
        state: 'success',
        resultJson: JSON.stringify({
          resultUrls: ['https://example.com/video.mp4'],
          firstFrameUrl: ['https://example.com/first.png'],
          lastFrameUrl: ['https://example.com/last.png'],
        }),
      },
    })))

    await expect(continuePolling({
      apiKey: 'kie-secret',
      route: '/api/v1/jobs/createTask',
      taskId: 'kie-task-2',
      requestId: 'local-poll-1',
      polling: { interval: 0, maxAttempts: 1 },
    })).resolves.toMatchObject({
      status: 'completed',
      url: [
        'https://example.com/video.mp4',
        'https://example.com/first.png',
        'https://example.com/last.png',
      ].join('|||'),
    })
  })

  it('解析 resultObject 内的图层媒体 URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      success: true,
      data: {
        state: 'success',
        resultJson: JSON.stringify({
          resultObject: {
            layers_data: [
              { z_index: 0, url: 'https://example.com/base.jpeg' },
              { z_index: 1, url: 'https://example.com/layer.png' },
            ],
          },
        }),
      },
    })))

    await expect(continuePolling({
      apiKey: 'kie-secret',
      route: '/api/v1/jobs/createTask',
      taskId: 'kie-task-layers',
      requestId: 'local-poll-2',
      polling: { interval: 0, maxAttempts: 1 },
    })).resolves.toMatchObject({
      status: 'completed',
      url: 'https://example.com/base.jpeg|||https://example.com/layer.png',
    })
  })

  it('创建接口 success=false 时保留 KIE 错误消息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      msg: 'model is unavailable',
    })))

    await expect(execute({
      apiKey: 'kie-secret',
      route: '/api/v1/jobs/createTask',
      method: 'POST',
      body: {},
      requestId: 'local-request-failed',
    })).rejects.toMatchObject({
      code: 'provider_task_failed',
      message: expect.stringContaining('model is unavailable'),
    })
  })
})
