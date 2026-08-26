import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildGrsaiEndpoints,
  markGrsaiEndpointReachable,
  resetGrsaiEndpointPreference,
  warmGrsaiEndpointPreference,
} from './grsai-endpoints'

describe('Grsai 端点排序', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetGrsaiEndpointPreference()
  })

  it('默认按全球节点优先的固定顺序', () => {
    expect(buildGrsaiEndpoints('/v1/api/generate')).toEqual([
      'https://grsaiapi.com/v1/api/generate',
      'https://grsai.dakka.com.cn/v1/api/generate',
    ])
  })

  it('记录可达域名后，该域名排到最前面', () => {
    markGrsaiEndpointReachable('https://grsai.dakka.com.cn/v1/api/result')

    expect(buildGrsaiEndpoints('/v1/api/generate')).toEqual([
      'https://grsai.dakka.com.cn/v1/api/generate',
      'https://grsaiapi.com/v1/api/generate',
    ])
  })

  it('无法识别的 endpoint 不影响顺序', () => {
    markGrsaiEndpointReachable('https://unknown.example.com/v1/api/result')

    expect(buildGrsaiEndpoints('/v1/api/generate')[0]).toBe('https://grsaiapi.com/v1/api/generate')
  })

  it('reset 后恢复默认顺序', () => {
    markGrsaiEndpointReachable('https://grsai.dakka.com.cn/v1/api/result')
    resetGrsaiEndpointPreference()

    expect(buildGrsaiEndpoints('/v1/api/generate')[0]).toBe('https://grsaiapi.com/v1/api/generate')
  })

  it('启动预热探测：全球节点可达时保持默认顺序', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    await warmGrsaiEndpointPreference()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://grsaiapi.com/v1/api/result', expect.objectContaining({ method: 'GET' }))
    expect(buildGrsaiEndpoints('/v1/api/generate')[0]).toBe('https://grsaiapi.com/v1/api/generate')
  })

  it('启动预热探测：全球节点不通时把国内节点预热为优先域名', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    await warmGrsaiEndpointPreference()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(buildGrsaiEndpoints('/v1/api/generate')[0]).toBe('https://grsai.dakka.com.cn/v1/api/generate')
  })

  it('启动预热探测：全部域名都不通时保持默认顺序，静默失败', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(warmGrsaiEndpointPreference()).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(buildGrsaiEndpoints('/v1/api/generate')[0]).toBe('https://grsaiapi.com/v1/api/generate')
  })
})
