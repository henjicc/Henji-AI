import { describe, expect, it, vi } from 'vitest'

import { uploadToFal } from '../src/upload'
import { uploadToFalWithTransport } from '../src/upload/fal-transport'
import { fromBase64, toBase64, uploadToApiMart, uploadToKie } from '../src/upload/providers'
import { fakeRuntimeContext } from './providers/test-helpers'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function transportFor(fetchMock: typeof fetch) {
  return fakeRuntimeContext(fetchMock).transport
}

describe('upload providers', () => {
  it('通过 Transport 完成 Fal initiate + signed PUT 并保持两参数兼容 wrapper', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        upload_url: 'https://signed.example/upload?signature=redacted',
        file_url: 'https://v3b.fal.media/files/b/example/reference.png',
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    const prepared = {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      filename: 'reference.png',
    }

    await expect(uploadToFalWithTransport(
      'fal-secret',
      prepared,
      transportFor(fetchMock)
    )).resolves.toBe('https://v3b.fal.media/files/b/example/reference.png')

    expect(fetchMock).toHaveBeenNthCalledWith(1,
      'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Key fal-secret' }),
        body: JSON.stringify({ content_type: 'image/png', file_name: 'reference.png' }),
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      'https://signed.example/upload?signature=redacted',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: expect.any(ArrayBuffer),
      })
    )

    const legacyFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        upload_url: 'https://signed.example/legacy?signature=redacted',
        file_url: 'https://v3b.fal.media/files/b/example/legacy.png',
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', legacyFetch)
    try {
      await expect(uploadToFal('fal-secret', prepared)).resolves.toBe(
        'https://v3b.fal.media/files/b/example/legacy.png'
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('通过 APIMart 官方 multipart 接口上传图片并返回公网 URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      url: 'https://upload.apimart.ai/f/image/example.png',
    }))

    await expect(uploadToApiMart('apimart-secret', {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      filename: 'example.png',
    }, transportFor(fetchMock))).resolves.toBe('https://upload.apimart.ai/f/image/example.png')

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
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }))

    await expect(uploadToApiMart('apimart-secret', {
      bytes: new Uint8Array([1]),
      mimeType: 'image/jpeg',
      filename: 'example.jpg',
    }, transportFor(fetchMock))).rejects.toMatchObject({
      code: 'upload_failed',
      message: expect.stringContaining('missing file URL'),
    })
  })

  it('APIMart 上传前拒绝不支持的图片格式', async () => {
    const fetchMock = vi.fn()

    await expect(uploadToApiMart('apimart-secret', {
      bytes: new Uint8Array([1]),
      mimeType: 'image/bmp',
      filename: 'example.bmp',
    }, transportFor(fetchMock))).rejects.toMatchObject({
      code: 'unsupported_media_type',
      message: expect.stringContaining('JPEG、PNG、WebP、GIF'),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('APIMart 上传前拒绝超过 20 MB 的图片', async () => {
    const fetchMock = vi.fn()

    await expect(uploadToApiMart('apimart-secret', {
      bytes: new Uint8Array(20 * 1024 * 1024 + 1),
      mimeType: 'image/png',
      filename: 'large.png',
    }, transportFor(fetchMock))).rejects.toMatchObject({
      code: 'upload_too_large',
      message: expect.stringContaining('20 MB'),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('APIMart 上传接口的鉴权失败保留 HTTP 状态', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      error: { message: 'API key is required' },
    }, 401))

    await expect(uploadToApiMart('invalid-key', {
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
      filename: 'example.png',
    }, transportFor(fetchMock))).rejects.toMatchObject({
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

    await expect(uploadToKie('kie-secret', {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      filename: 'example.png',
    }, transportFor(fetchMock))).resolves.toBe('https://tempfile.redpandaai.co/unique/example.png')

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const form = request.body as FormData
    expect(form.get('uploadPath')).toBe('henji-uploads')
    expect(form.get('fileName')).toBeNull()
    expect((form.get('file') as File).name).toBe('example.png')
  })
})

describe('toBase64 / fromBase64（不依赖 Buffer 的可移植实现）', () => {
  it('对空字节数组返回空字符串', () => {
    expect(toBase64(new Uint8Array())).toBe('')
  })

  it('正确编码二进制边界字节 0x00 与 0xFF', () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x00, 0xff, 0x10, 0x80])
    const encoded = toBase64(bytes)
    // 用平台自带的 atob 独立验证编码结果，不依赖被测代码本身的解码逻辑。
    const decoded = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    expect(Array.from(decoded)).toEqual(Array.from(bytes))
  })

  it('分块编码大于 64KB 的输入时不丢字节、不爆栈', () => {
    const size = 64 * 1024 + 777 // 故意跨越分块边界，且不是分块大小的整数倍
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i += 1) {
      bytes[i] = i % 256
    }

    const encoded = toBase64(bytes)
    const decoded = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    expect(decoded.length).toBe(size)
    expect(Array.from(decoded)).toEqual(Array.from(bytes))
  })

  it('fromBase64 是 toBase64 的逆运算（含二进制边界字节的往返一致性）', () => {
    const bytes = new Uint8Array(70_000)
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = (i * 31 + 0xff) % 256
    }
    bytes[0] = 0x00
    bytes[1] = 0xff

    const roundTripped = fromBase64(toBase64(bytes))
    expect(Array.from(roundTripped)).toEqual(Array.from(bytes))
  })
})
