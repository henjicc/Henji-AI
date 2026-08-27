import { describe, expect, it, vi } from 'vitest'

import { testProviderConnection } from '../../src/providers/connection'
import type { RuntimeContext } from '../../src/runtime'

/**
 * 迁移前用 `vi.mock('../keystore')`/`vi.mock('../logging')` 替换 `testProviderConnection`
 * 隐式依赖的全局模块；迁移后 `testProviderConnection` 改为显式接收 `RuntimeContext`，
 * 直接构造一个假 `credentials.get` 返回约定好的 apiKey 即可，语义与之前的模块 mock 等价——
 * 都是"这次密钥读取返回这个值"。
 */
function runtimeWithKey(apiKey: string | undefined, fetchMock: ReturnType<typeof vi.fn>): RuntimeContext {
  return {
    transport: { fetch: fetchMock },
    credentials: { get: () => apiKey },
    media: {
      read: () => {
        throw new Error('media.read should not be called by testProviderConnection')
      },
    },
  }
}

describe('testProviderConnection', () => {
  it('未配置密钥时不发起网络请求', async () => {
    const fetchMock = vi.fn()

    await expect(testProviderConnection('kie', runtimeWithKey(undefined, fetchMock))).resolves.toMatchObject({
      providerId: 'kie',
      status: 'not_configured',
      verified: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('没有安全只读探针的供应商明确返回已保存但未在线验证', async () => {
    const fetchMock = vi.fn()

    await expect(testProviderConnection('fal', runtimeWithKey('test-key', fetchMock))).resolves.toMatchObject({
      providerId: 'fal',
      status: 'saved_unverified',
      verified: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('通过 KIE 官方余额接口验证并返回积分', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      msg: 'success',
      data: 128,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(testProviderConnection('kie', runtimeWithKey('test-key', fetchMock))).resolves.toMatchObject({
      status: 'connected',
      verified: true,
      remainingBalance: 128,
      balanceUnit: 'credits',
      httpStatus: 200,
    })
  })

  it('识别 APIMart 以 200 返回的无效令牌', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      message: 'Failed to get token info: record not found',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(testProviderConnection('apimart', runtimeWithKey('test-key', fetchMock))).resolves.toMatchObject({
      status: 'invalid_key',
      verified: false,
      httpStatus: 200,
    })
  })

  it('余额不足仍说明认证已通过', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 402 }))

    await expect(testProviderConnection('ppio', runtimeWithKey('test-key', fetchMock))).resolves.toMatchObject({
      status: 'insufficient_balance',
      verified: true,
      httpStatus: 402,
    })
  })
})
