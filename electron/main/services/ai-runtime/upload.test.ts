import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getAiProviderApiKey } from '../keystore'
import { preprocessRequestBody } from './upload'

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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('request media preprocessing', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockedGetKey.mockImplementation((providerId) => providerId === 'apimart' ? 'apimart-secret' : null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('APIMart 本地图片先上传，再把生成请求中的输入改成公网 URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      url: 'https://upload.apimart.ai/f/image/reference.png',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(preprocessRequestBody(
      'apimart',
      '/v1/images/generations',
      { image_urls: ['data:image/png;base64,AQID'] },
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
    vi.stubGlobal('fetch', fetchMock)

    await expect(preprocessRequestBody(
      'apimart',
      '/v1/midjourney/generations',
      { cref: 'data:image/png;base64,AQID' },
      { apimartMidjourneyCharacterReference: ['data:image/png;base64,AQID'] },
      { mediaFields: [{ field: 'cref', kind: 'image' }] }
    )).resolves.toEqual({
      cref: 'https://upload.apimart.ai/f/image/character.png',
    })
  })

  it('APIMart 未配置 Key 时说明可用的修正方式', async () => {
    mockedGetKey.mockReturnValue(null)

    await expect(preprocessRequestBody(
      'apimart',
      '/v1/images/generations',
      { image_url: 'data:image/png;base64,AQID' },
      { image: 'data:image/png;base64,AQID' }
    )).rejects.toMatchObject({
      code: 'missing_api_key',
      message: expect.stringContaining('配置 APIMart API Key'),
    })
  })

  it('APIMart 本地视频在提交前明确要求公网 URL', async () => {
    await expect(preprocessRequestBody(
      'apimart',
      '/v1/videos/generations',
      { video_url: 'data:video/mp4;base64,AQID' },
      { video: 'data:video/mp4;base64,AQID' }
    )).rejects.toMatchObject({
      code: 'public_media_url_required',
      message: expect.stringContaining('没有通用的视频上传端点'),
    })
  })
})
