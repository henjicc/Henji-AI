import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildApiMartEndpoints,
  markApiMartEndpointReachable,
  resetApiMartEndpointPreference,
  warmApiMartEndpointPreference,
} from './apimart-endpoints'

describe('APIMart 端点排序', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetApiMartEndpointPreference()
  })

  it('默认按海外主站优先的固定顺序', () => {
    expect(buildApiMartEndpoints('/v1/tasks/x')).toEqual([
      'https://api.apimart.ai/v1/tasks/x',
      'https://api.apib.ai/v1/tasks/x',
      'https://api.aiuxu.com/v1/tasks/x',
      'https://api.aishuch.com/v1/tasks/x',
    ])
  })

  it('记录可达域名后，该域名排到最前面，其余域名仍留作兜底', () => {
    markApiMartEndpointReachable('https://api.aiuxu.com/v1/balance')

    expect(buildApiMartEndpoints('/v1/tasks/x')).toEqual([
      'https://api.aiuxu.com/v1/tasks/x',
      'https://api.apimart.ai/v1/tasks/x',
      'https://api.apib.ai/v1/tasks/x',
      'https://api.aishuch.com/v1/tasks/x',
    ])
  })

  it('无法识别的 endpoint 不影响顺序', () => {
    markApiMartEndpointReachable('https://unknown.example.com/v1/balance')

    expect(buildApiMartEndpoints('/v1/tasks/x')[0]).toBe('https://api.apimart.ai/v1/tasks/x')
  })

  it('reset 后恢复默认顺序', () => {
    markApiMartEndpointReachable('https://api.aishuch.com/v1/balance')
    resetApiMartEndpointPreference()

    expect(buildApiMartEndpoints('/v1/tasks/x')[0]).toBe('https://api.apimart.ai/v1/tasks/x')
  })

  it('启动预热探测：主域名可达时保持默认顺序', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await warmApiMartEndpointPreference()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://api.apimart.ai/v1/balance', expect.objectContaining({ method: 'GET' }))
    expect(buildApiMartEndpoints('/v1/tasks/x')[0]).toBe('https://api.apimart.ai/v1/tasks/x')
  })

  it('启动预热探测：主域名不通时把第一个可达的大陆域名预热为优先域名', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await warmApiMartEndpointPreference()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(buildApiMartEndpoints('/v1/tasks/x')[0]).toBe('https://api.apib.ai/v1/tasks/x')
  })

  it('启动预热探测：全部域名都不通时保持默认顺序，静默失败', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(warmApiMartEndpointPreference()).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(buildApiMartEndpoints('/v1/tasks/x')[0]).toBe('https://api.apimart.ai/v1/tasks/x')
  })
})
