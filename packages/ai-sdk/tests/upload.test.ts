import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { preprocessRequestBody } from '../src/upload/preprocess'
import type { CredentialStore, RuntimeContext, Transport } from '../src/runtime'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * 与迁移前 `vi.mock('../keystore', ...)` + `vi.stubGlobal('fetch', fetchMock)` 语义等价的
 * 假 `RuntimeContext`：凭据落到一张固定的 provider -> key 表，网络请求落到 `fetchMock`。
 * `media.read` 不该被调用到——这 4 个用例的媒体源都是 `data:` URI，`data:` 解析完全留在
 * SDK 内部，不触碰 `MediaReader`；一旦哪次改动意外调用了它，测试会用明确错误立刻失败。
 */
function fakeRuntime(fetchMock: Transport['fetch'], keys: Record<string, string | null>): RuntimeContext {
  const credentials: CredentialStore = {
    get: (_scope, providerId) => keys[providerId] ?? undefined,
  }
  return {
    transport: { fetch: fetchMock },
    credentials,
    media: {
      read: () => {
        throw new Error('media.read should not be called by these data: URI cases')
      },
    },
  }
}

describe('request media preprocessing', () => {
  let mockedKeys: Record<string, string | null>

  beforeEach(() => {
    mockedKeys = { apimart: 'apimart-secret' }
  })

  afterEach(() => vi.useRealTimers())

  it.each(['kie', 'modelscope'])('%s 上传失败保留根因、记录失败且不回退 data URI', async providerId => {
    // synthetic-negative：缺 URL、HTTP 故障、网络失败，不冒充官方响应。
    for (const failure of [
      () => Promise.resolve(jsonResponse({ success: true })),
      () => Promise.resolve(jsonResponse({ msg: 'upload quota exhausted' }, 503)),
      () => Promise.reject(new TypeError('connection lost')),
    ]) {
      const fetchMock = vi.fn().mockImplementation(failure)
      const runtime = fakeRuntime(fetchMock, { kie: 'fixture-key' })
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      runtime.logger = logger
      const error = await preprocessRequestBody(providerId, '/api/v1/jobs/createTask', { image_url: 'data:image/png;base64,AQID' }, runtime, {}, undefined, 'upload-regression').catch((error: unknown) => error)
      expect(error).toMatchObject({ code: expect.stringMatching(/^(upload_failed|provider_network_error)$/) })
      expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'ai_runtime.upload.kie_failed', requestId: 'upload-regression', providerId, error }))
      expect(logger.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'ai_runtime.upload.kie_started', context: { route: '/api/v1/jobs/createTask', mimeType: 'image/png', bytes: 3 } }))
      expect(logger.warn).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it.each(['kie', 'modelscope'])('%s 缺 KIE Key 时拒绝本地媒体并说明修正方式', async providerId => {
    const fetchMock = vi.fn()
    await expect(preprocessRequestBody(providerId, '/api/v1/jobs/createTask', { image_url: 'data:image/png;base64,AQID' }, fakeRuntime(fetchMock, {}))).rejects.toMatchObject({ code: 'missing_api_key', message: expect.stringContaining('配置 KIE API Key') })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('KIE 上传成功记录完成并回填公网 URL', async () => {
    const runtime = fakeRuntime(vi.fn().mockResolvedValue(jsonResponse({ data: { downloadUrl: 'https://media.invalid/reference.png' } })), { kie: 'fixture-key' })
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    runtime.logger = logger
    await expect(preprocessRequestBody('kie', '/api/v1/jobs/createTask', { image_url: 'data:image/png;base64,AQID' }, runtime)).resolves.toEqual({ image_url: 'https://media.invalid/reference.png' })
    expect(logger.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'ai_runtime.upload.kie_completed', providerId: 'kie' }))
    expect(logger.error).not.toHaveBeenCalled()
  })

  it.each(['kie', 'ppio', 'apimart'])('%s 上传中取消立即拒绝，保留取消语义并释放计时器', async providerId => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let uploadSignal: AbortSignal | null | undefined
    let started!: () => void
    const startedPromise = new Promise<void>(resolve => { started = resolve })
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      uploadSignal = init?.signal
      started()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    const runtime = fakeRuntime(fetchMock, { kie: 'fixture-key', apimart: 'fixture-key' })
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    runtime.logger = logger
    const result = preprocessRequestBody(providerId, '/fixture', { image_url: 'data:image/png;base64,AQID' }, runtime, {}, undefined, 'cancel-regression', controller.signal).catch((error: unknown) => error)
    await startedPromise
    try {
      expect(uploadSignal).toBeInstanceOf(AbortSignal)
    } finally {
      controller.abort()
    }
    expect(uploadSignal?.aborted).toBe(true)
    expect(await result).toMatchObject({ code: 'cancelled' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logger.error).not.toHaveBeenCalled()
    if (providerId !== 'ppio') expect(logger.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: `ai_runtime.upload.${providerId}_cancelled` }))
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['kie', 'ppio', 'apimart'])('%s 重试退避中取消，不重传且不改包错误', async providerId => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }))
    const result = preprocessRequestBody(providerId, '/fixture', { image_url: 'data:image/png;base64,AQID' }, fakeRuntime(fetchMock, { kie: 'fixture-key', apimart: 'fixture-key' }), {}, undefined, 'retry-cancel-regression', controller.signal).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(providerId === 'apimart' ? 4 : 1)
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    controller.abort()
    expect(await result).toMatchObject({ code: 'cancelled' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('APIMart 本地图片先上传，再把生成请求中的输入改成公网 URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      url: 'https://upload.apimart.ai/f/image/reference.png',
    }))

    await expect(preprocessRequestBody(
      'apimart',
      '/v1/images/generations',
      { image_urls: ['data:image/png;base64,AQID'] },
      fakeRuntime(fetchMock, mockedKeys),
      { images: ['data:image/png;base64,AQID'] }
    )).resolves.toEqual({
      image_urls: ['https://upload.apimart.ai/f/image/reference.png'],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('按模型 schema 声明上传 Midjourney 特殊参考图字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      url: 'https://upload.apimart.ai/f/image/character.png',
    }))

    await expect(preprocessRequestBody(
      'apimart',
      '/v1/midjourney/generations',
      { cref: 'data:image/png;base64,AQID' },
      fakeRuntime(fetchMock, mockedKeys),
      { apimartMidjourneyCharacterReference: ['data:image/png;base64,AQID'] },
      { mediaFields: [{ field: 'cref', kind: 'image' }] }
    )).resolves.toEqual({
      cref: 'https://upload.apimart.ai/f/image/character.png',
    })
  })

  it('APIMart 未配置 Key 时说明可用的修正方式', async () => {
    mockedKeys.apimart = null
    const fetchMock = vi.fn()

    await expect(preprocessRequestBody(
      'apimart',
      '/v1/images/generations',
      { image_url: 'data:image/png;base64,AQID' },
      fakeRuntime(fetchMock, mockedKeys),
      { image: 'data:image/png;base64,AQID' }
    )).rejects.toMatchObject({
      code: 'missing_api_key',
      message: expect.stringContaining('配置 APIMart API Key'),
    })
  })

  it('APIMart 本地视频在提交前明确要求公网 URL', async () => {
    const fetchMock = vi.fn()

    await expect(preprocessRequestBody(
      'apimart',
      '/v1/videos/generations',
      { video_url: 'data:video/mp4;base64,AQID' },
      fakeRuntime(fetchMock, mockedKeys),
      { video: 'data:video/mp4;base64,AQID' }
    )).rejects.toMatchObject({
      code: 'public_media_url_required',
      message: expect.stringContaining('没有通用的视频上传端点'),
    })
  })
})
