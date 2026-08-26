import { beforeEach, describe, expect, it, vi } from 'vitest'

const nativeFetch = vi.fn()

vi.mock('@/platform/desktopApi', () => ({
  nativeFetch: (...args: unknown[]) => nativeFetch(...args)
}))

vi.mock('@/core/logging', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

import { checkModelscopeModelAvailability } from './availability'

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload
  } as unknown as Response
}

/** 真实响应结构（2026-08-26 实测） */
const AVAILABLE_PAYLOAD = {
  Code: 200,
  Data: {
    Providers: [{ Name: 'ModelScope', CostTier: 'standard', EstimatedMagicGrainCost: 1 }],
    TotalCount: 1
  },
  Success: true
}

const UNAVAILABLE_PAYLOAD = {
  Code: 200,
  Data: { Providers: null, TotalCount: 0 },
  Success: true
}

describe('checkModelscopeModelAvailability', () => {
  beforeEach(() => {
    nativeFetch.mockReset()
  })

  it('支持 API-Inference 的模型返回 available，并带出魔粒档位', async () => {
    nativeFetch.mockResolvedValue(jsonResponse(AVAILABLE_PAYLOAD))

    const result = await checkModelscopeModelAvailability('Tongyi-MAI/Z-Image-Turbo')

    expect(result).toEqual({ state: 'available', costTier: 'standard', magicGrainCost: 1 })
  })

  it('Providers 为 null 时判定为 unavailable', async () => {
    nativeFetch.mockResolvedValue(jsonResponse(UNAVAILABLE_PAYLOAD))

    const result = await checkModelscopeModelAvailability('black-forest-labs/FLUX.1-dev')

    expect(result).toEqual({ state: 'unavailable' })
  })

  it('模型 ID 会被 URL 编码后拼进查询串', async () => {
    nativeFetch.mockResolvedValue(jsonResponse(AVAILABLE_PAYLOAD))

    await checkModelscopeModelAvailability('Qwen/Qwen-Image-Edit-2509')

    const [url] = nativeFetch.mock.calls[0]
    expect(url).toContain('ModelId=Qwen%2FQwen-Image-Edit-2509')
  })

  it('空 ID 直接判定 not-found，不发请求', async () => {
    const result = await checkModelscopeModelAvailability('   ')

    expect(result).toEqual({ state: 'not-found' })
    expect(nativeFetch).not.toHaveBeenCalled()
  })

  it('HTTP 500 判定为 not-found——魔搭对查不到的 ID 就是返回 500', async () => {
    nativeFetch.mockResolvedValue(jsonResponse(null, false, 500))

    const result = await checkModelscopeModelAvailability('Qwen/NoSuchModelXYZ')

    expect(result).toEqual({ state: 'not-found' })
  })

  it('网络失败返回 unknown 而不是 unavailable——不能因为查不到就当成不支持', async () => {
    nativeFetch.mockRejectedValue(new Error('offline'))

    const result = await checkModelscopeModelAvailability('Qwen/Qwen-Image')

    expect(result).toEqual({ state: 'unknown', reason: 'offline' })
  })

  it('非 2xx 响应返回 unknown', async () => {
    nativeFetch.mockResolvedValue(jsonResponse(null, false, 503))

    const result = await checkModelscopeModelAvailability('Qwen/Qwen-Image')

    expect(result).toEqual({ state: 'unknown', reason: 'HTTP 503' })
  })

  it('响应结构变化（缺 Data）时返回 unavailable 而不是抛错', async () => {
    nativeFetch.mockResolvedValue(jsonResponse({ Code: 200, Success: true }))

    const result = await checkModelscopeModelAvailability('Qwen/Qwen-Image')

    expect(result).toEqual({ state: 'unavailable' })
  })
})
