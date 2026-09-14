import { afterEach, describe, expect, it, vi } from 'vitest'
import createFixture from '../fixtures/kie/create-task-success.json'
import pollFixture from '../fixtures/kie/poll-success.json'

import { continuePolling, execute } from '../../src/providers/kie'
import { fakeRuntimeContext } from './test-helpers'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('KIE provider', () => {
  afterEach(() => vi.useRealTimers())
  it('提交后查询连接中断只续查原任务，不重新 POST', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(createFixture.response))
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }) }))
      .mockResolvedValueOnce(jsonResponse(pollFixture.response))
    const runtime = fakeRuntimeContext(fetchMock)
    const created = await execute({ apiKey: 'fixture', route: '/api/v1/jobs/createTask', method: 'POST', body: {}, requestId: 'recovery-test', runtime })
    const result = continuePolling({ apiKey: 'fixture', taskId: created.taskId!, requestId: 'recovery-test', runtime })
    await vi.runAllTimersAsync()
    expect((await result).status).toBe('completed')
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    const queries = fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET')
    expect(queries).toHaveLength(2)
    expect(queries[0][0]).toBe(queries[1][0])
    expect(queries[0][0]).toContain(created.taskId)
  })
  it('按 Market 公共契约提交任务并读取 taskId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      success: true,
      data: { taskId: 'kie-task-1' },
    }))

    await expect(execute({
      apiKey: 'kie-secret',
      route: '/api/v1/jobs/createTask',
      method: 'POST',
      body: { model: 'example-model', input: { prompt: 'cat' } },
      requestId: 'local-request-1',
      runtime: fakeRuntimeContext(fetchMock),
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
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
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
    }))

    await expect(continuePolling({
      apiKey: 'kie-secret',
      route: '/api/v1/jobs/createTask',
      taskId: 'kie-task-2',
      requestId: 'local-poll-1',
      polling: { interval: 0, maxAttempts: 1 },
      runtime: fakeRuntimeContext(fetchMock),
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
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
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
    }))

    await expect(continuePolling({
      apiKey: 'kie-secret',
      route: '/api/v1/jobs/createTask',
      taskId: 'kie-task-layers',
      requestId: 'local-poll-2',
      polling: { interval: 0, maxAttempts: 1 },
      runtime: fakeRuntimeContext(fetchMock),
    })).resolves.toMatchObject({
      status: 'completed',
      url: 'https://example.com/base.jpeg|||https://example.com/layer.png',
    })
  })

  it('创建接口 success=false 时保留 KIE 错误消息', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      msg: 'model is unavailable',
    }))

    await expect(execute({
      apiKey: 'kie-secret',
      route: '/api/v1/jobs/createTask',
      method: 'POST',
      body: {},
      requestId: 'local-request-failed',
      runtime: fakeRuntimeContext(fetchMock),
    })).rejects.toMatchObject({
      code: 'provider_task_failed',
      message: expect.stringContaining('model is unavailable'),
    })
  })
})
