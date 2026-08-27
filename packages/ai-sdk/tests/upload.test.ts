import { beforeEach, describe, expect, it, vi } from 'vitest'

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
