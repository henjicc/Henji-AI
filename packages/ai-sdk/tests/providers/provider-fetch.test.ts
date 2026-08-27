import { describe, expect, it, vi } from 'vitest'

import { fetchProvider } from '../../src/providers/provider-fetch'
import { fakeRuntimeContext } from './test-helpers'

function networkError(code: string): TypeError {
  const error = new TypeError('fetch failed')
  Object.assign(error, {
    cause: Object.assign(new Error(`network failure: ${code}`), { code }),
  })
  return error
}

describe('fetchProvider', () => {
  it('仅对能证明尚未建立连接的故障重试一次', async () => {
    const response = new Response('{}', { status: 200 })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(networkError('UND_ERR_CONNECT_TIMEOUT'))
      .mockResolvedValueOnce(response)

    const result = await fetchProvider(
      'KIE',
      'https://api.kie.ai/api/v1/jobs/createTask',
      { method: 'POST', body: '{}' },
      { transport: fakeRuntimeContext(fetchMock).transport, retryPreconnectOnce: true }
    )

    expect(result).toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('连接状态不明确时不重试 POST，避免重复计费任务', async () => {
    const fetchMock = vi.fn().mockRejectedValue(networkError('UND_ERR_SOCKET'))

    await expect(fetchProvider(
      'KIE',
      'https://api.kie.ai/api/v1/jobs/createTask',
      { method: 'POST', body: '{}' },
      { transport: fakeRuntimeContext(fetchMock).transport, retryPreconnectOnce: true }
    )).rejects.toMatchObject({
      code: 'provider_network_error',
      message: expect.stringContaining('UND_ERR_SOCKET'),
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('主线路尚未建立连接时按顺序切换备用线路', async () => {
    const response = new Response('{}', { status: 200 })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(networkError('ENETUNREACH'))
      .mockResolvedValueOnce(response)

    await expect(fetchProvider(
      'APIMart',
      'https://api.apimart.ai/v1/tasks/task-1',
      { method: 'GET' },
      {
        transport: fakeRuntimeContext(fetchMock).transport,
        retryPreconnectOnce: true,
        fallbackEndpoints: ['https://api.apib.ai/v1/tasks/task-1'],
      }
    )).resolves.toBe(response)

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.apimart.ai/v1/tasks/task-1',
      'https://api.apib.ai/v1/tasks/task-1',
    ])
  })

  it('用户取消或超时中止不触发重试', async () => {
    const controller = new AbortController()
    controller.abort()
    const abortError = new DOMException('aborted', 'AbortError')
    const fetchMock = vi.fn().mockRejectedValue(abortError)

    await expect(fetchProvider(
      'KIE',
      'https://api.kie.ai/api/v1/jobs/recordInfo',
      { method: 'GET', signal: controller.signal },
      { transport: fakeRuntimeContext(fetchMock).transport, retryPreconnectOnce: true }
    )).rejects.toBe(abortError)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
