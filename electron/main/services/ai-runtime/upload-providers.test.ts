import { afterEach, describe, expect, it, vi } from 'vitest'

const falUploadMock = vi.hoisted(() => vi.fn())

vi.mock('@fal-ai/client', () => ({
  createFalClient: vi.fn(() => ({ storage: { upload: falUploadMock } })),
}))

import { uploadToApiMart, uploadToFal, uploadToKie } from './upload-providers'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('upload providers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    falUploadMock.mockReset()
  })

  it('通过 Fal 官方存储客户端上传文件并返回 CDN URL', async () => {
    falUploadMock.mockResolvedValue('https://v3b.fal.media/files/b/example/reference.png')

    await expect(uploadToFal('fal-secret', {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      filename: 'reference.png',
    })).resolves.toBe('https://v3b.fal.media/files/b/example/reference.png')

    const file = falUploadMock.mock.calls[0]?.[0] as File
    expect(file.name).toBe('reference.png')
    expect(file.type).toBe('image/png')
    expect(file.size).toBe(3)
  })

  it('通过 APIMart 官方 multipart 接口上传图片并返回公网 URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      url: 'https://upload.apimart.ai/f/image/example.png',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadToApiMart('apimart-secret', {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      filename: 'example.png',
    })).resolves.toBe('https://upload.apimart.ai/f/image/example.png')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.apimart.ai/v1/uploads/images',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer apimart-secret' },
        body: expect.any(FormData),
      })
    )
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const form = request.body as FormData
    const file = form.get('file') as File
    expect(file.name).toBe('example.png')
    expect(file.type).toBe('image/png')
    expect(file.size).toBe(3)
  })

  it('APIMart 上传成功但缺少 URL 时给出可定位错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true })))

    await expect(uploadToApiMart('apimart-secret', {
      bytes: new Uint8Array([1]),
      mimeType: 'image/jpeg',
      filename: 'example.jpg',
    })).rejects.toMatchObject({
      code: 'upload_failed',
      message: expect.stringContaining('missing file URL'),
    })
  })

  it('APIMart 上传前拒绝不支持的图片格式', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadToApiMart('apimart-secret', {
      bytes: new Uint8Array([1]),
      mimeType: 'image/bmp',
      filename: 'example.bmp',
    })).rejects.toMatchObject({
      code: 'unsupported_media_type',
      message: expect.stringContaining('JPEG、PNG、WebP、GIF'),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('APIMart 上传前拒绝超过 20 MB 的图片', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadToApiMart('apimart-secret', {
      bytes: new Uint8Array(20 * 1024 * 1024 + 1),
      mimeType: 'image/png',
      filename: 'large.png',
    })).rejects.toMatchObject({
      code: 'upload_too_large',
      message: expect.stringContaining('20 MB'),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('APIMart 上传接口的鉴权失败保留 HTTP 状态', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { message: 'API key is required' },
    }, 401)))

    await expect(uploadToApiMart('invalid-key', {
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
      filename: 'example.png',
    })).rejects.toMatchObject({
      code: 'upload_failed',
      message: expect.stringContaining('HTTP 401'),
    })
  })

  it('KIE 上传不指定易冲突的远端文件名，并读取 downloadUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      code: 200,
      data: { downloadUrl: 'https://tempfile.redpandaai.co/unique/example.png' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadToKie('kie-secret', {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      filename: 'example.png',
    })).resolves.toBe('https://tempfile.redpandaai.co/unique/example.png')

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const form = request.body as FormData
    expect(form.get('uploadPath')).toBe('henji-uploads')
    expect(form.get('fileName')).toBeNull()
    expect((form.get('file') as File).name).toBe('example.png')
  })
})
