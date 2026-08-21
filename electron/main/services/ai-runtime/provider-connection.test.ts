import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAiProviderApiKey } from '../keystore'
import { testProviderConnection } from './provider-connection'

vi.mock('../keystore', () => ({
  getAiProviderApiKey: vi.fn(),
}))

vi.mock('../logging', () => ({
  createMainLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const mockedGetKey = vi.mocked(getAiProviderApiKey)

describe('testProviderConnection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockedGetKey.mockReturnValue('test-key')
  })

  it('未配置密钥时不发起网络请求', async () => {
    mockedGetKey.mockReturnValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(testProviderConnection('kie')).resolves.toMatchObject({
      providerId: 'kie',
      status: 'not_configured',
      verified: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('没有安全只读探针的供应商明确返回已保存但未在线验证', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(testProviderConnection('fal')).resolves.toMatchObject({
      providerId: 'fal',
      status: 'saved_unverified',
      verified: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('通过 KIE 官方余额接口验证并返回积分', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      msg: 'success',
      data: 128,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    await expect(testProviderConnection('kie')).resolves.toMatchObject({
      status: 'connected',
      verified: true,
      remainingBalance: 128,
      balanceUnit: 'credits',
      httpStatus: 200,
    })
  })

  it('识别 APIMart 以 200 返回的无效令牌', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      message: 'Failed to get token info: record not found',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    await expect(testProviderConnection('apimart')).resolves.toMatchObject({
      status: 'invalid_key',
      verified: false,
      httpStatus: 200,
    })
  })

  it('余额不足仍说明认证已通过', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 402 })))

    await expect(testProviderConnection('ppio')).resolves.toMatchObject({
      status: 'insufficient_balance',
      verified: true,
      httpStatus: 402,
    })
  })
})
