import { afterEach, describe, expect, it, vi } from 'vitest'

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
  afterEach(() => vi.useRealTimers())
  // Node 官方 TLS onConnectEnd 错误形状；嵌套 TypeError 来自 fetch，测试 transport 为合成负例。
  // https://github.com/nodejs/node/blob/v24.0.0/lib/_tls_wrap.js#L1573-L1585
  const beforeTls = () => new TypeError('fetch failed', { cause: Object.assign(
    new Error('Client network socket disconnected before secure TLS connection was established'), { code: 'ECONNRESET' }) })

  it('TLS 尚未建立的 POST 可以依次切换全部备用端点，成功后仅记住该端点', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(beforeTls()).mockRejectedValueOnce(beforeTls())
      .mockRejectedValueOnce(beforeTls()).mockResolvedValueOnce(new Response('{}'))
    const reached = vi.fn()
    await fetchProvider('APIMart', 'https://a.test/create', { method: 'POST', body: '{}' }, {
      transport: fakeRuntimeContext(fetchMock).transport, retryPreconnectOnce: true,
      fallbackEndpoints: ['https://b.test/create', 'https://c.test/create', 'https://d.test/create'], onEndpointReached: reached,
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://a.test/create', 'https://b.test/create', 'https://c.test/create', 'https://d.test/create'])
    expect(reached.mock.calls).toEqual([['https://d.test/create']])
  })

  it.each(['POST', 'PATCH', 'DELETE'])('普通 ECONNRESET 不允许重放 %s，并保留脱敏的未知提交诊断', async method => {
    const fetchMock = vi.fn().mockRejectedValue(networkError('ECONNRESET'))
    const error = await fetchProvider('APIMart', 'https://a.test/private-task?key=secret', { method, body: 'private-prompt' }, {
      transport: fakeRuntimeContext(fetchMock).transport, retryPreconnectOnce: true, fallbackEndpoints: ['https://b.test/create'],
    }).catch(error => error)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(error.details).toMatchObject({ submissionState: 'unknown', attempts: [{ host: 'a.test', code: 'ECONNRESET', stage: 'unknown' }] })
    expect(JSON.stringify(error)).not.toMatch(/secret|private-task|private-prompt/)
  })

  it.each(['GET', 'HEAD'])('%s 查询断线可安全换备用地址', async method => {
    const response = new Response('{}')
    const fetchMock = vi.fn().mockRejectedValueOnce(networkError('ECONNRESET')).mockResolvedValueOnce(response)
    await expect(fetchProvider('APIMart', 'https://a.test/query', { method }, {
      transport: fakeRuntimeContext(fetchMock).transport, retryPreconnectOnce: true, fallbackEndpoints: ['https://b.test/query'],
    })).resolves.toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('所有 TLS 前尝试失败时保留完整端点顺序和未发送状态', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockRejectedValue(beforeTls())
    const result = fetchProvider('APIMart', 'https://a.test/create', { method: 'POST' }, {
      transport: fakeRuntimeContext(fetchMock).transport, retryPreconnectOnce: true, fallbackEndpoints: ['https://b.test/create'],
    }).catch(error => error)
    await vi.runAllTimersAsync()
    const error = await result
    expect(error.details).toMatchObject({ submissionState: 'not_sent', attempts: [
      { host: 'a.test', code: 'ECONNRESET', stage: 'before_send' },
      { host: 'b.test', code: 'ECONNRESET', stage: 'before_send' },
      { host: 'b.test', code: 'ECONNRESET', stage: 'before_send' },
      { host: 'b.test', code: 'ECONNRESET', stage: 'before_send' },
      { host: 'b.test', code: 'ECONNRESET', stage: 'before_send' },
    ] })
  })

  it('退避期间取消不发出第二次请求', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockRejectedValue(beforeTls())
    const result = fetchProvider('KIE', 'https://a.test/create', { method: 'POST', signal: controller.signal }, {
      transport: fakeRuntimeContext(fetchMock).transport, retryPreconnectOnce: true,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort(new Error('cancelled during backoff'))
    await expect(result).rejects.toThrow('cancelled during backoff')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
  it('仅对能证明尚未建立连接的故障自动退避恢复', async () => {
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

  it('按 1、3、8 秒退避，恢复后只返回一次成功提交', async () => {
    vi.useFakeTimers()
    const times: number[] = []
    const fetchMock = vi.fn(async () => { times.push(Date.now()); if (times.length < 4) throw beforeTls(); return new Response('{}') })
    const result = fetchProvider('KIE', 'https://a.test/create', { method: 'POST', body: '{}' }, {
      transport: fakeRuntimeContext(fetchMock).transport, retryPreconnectOnce: true,
    })
    await vi.runAllTimersAsync()
    expect((await result).status).toBe(200)
    expect(times.map(time => time - times[0])).toEqual([0, 1000, 4000, 12000])
  })

  it('发送前失败后遇到未知提交状态必须停止，不能继续剩余退避', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockRejectedValueOnce(beforeTls()).mockRejectedValue(networkError('ECONNRESET'))
    const result = fetchProvider('KIE', 'https://a.test/create', { method: 'POST' }, {
      transport: fakeRuntimeContext(fetchMock).transport, retryPreconnectOnce: true,
    }).catch(error => error)
    await vi.runAllTimersAsync()
    expect((await result).details.submissionState).toBe('unknown')
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
