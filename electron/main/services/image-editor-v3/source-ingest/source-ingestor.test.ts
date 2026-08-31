import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceId, SourceImageMetadata, SourceProvider } from '../contracts'
import { ContentAddressedResourceStore } from '../resource-store'
import { ImageEditorV3SourceIngestor } from './source-ingestor'

let rootDir = ''
let resources: ContentAddressedResourceStore

function metadata(
  resourceId: ResourceId,
  patch: Partial<SourceImageMetadata> = {},
): SourceImageMetadata {
  return {
    resourceId,
    width: 20_000,
    height: 10_000,
    encodedWidth: 20_000,
    encodedHeight: 10_000,
    format: 'png',
    bitsPerSample: 8,
    orientation: 1,
    orientationApplied: true,
    hasAlpha: true,
    hasIccProfile: false,
    cicp: null,
    hdr: false,
    ...patch,
  }
}

let readMetadata = vi.fn(async (resourceId: ResourceId): Promise<SourceImageMetadata> => metadata(resourceId))

function sourceProvider(): SourceProvider {
  return { readMetadata } as unknown as SourceProvider
}

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-image-v3-ingest-'))
  resources = new ContentAddressedResourceStore(path.join(rootDir, 'resources'))
  readMetadata = vi.fn(async (resourceId: ResourceId): Promise<SourceImageMetadata> => metadata(resourceId))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

describe('ImageEditorV3SourceIngestor', () => {
  it('本地文件通过 putFile 流式进入内容寻址库，且结果不暴露路径', async () => {
    const filePath = path.join(rootDir, 'source.png')
    await fsp.writeFile(filePath, Buffer.from('local-image'))
    const ingestor = new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      limits: { localMaxBytes: 64 },
    })

    const result = await ingestor.ingest({ kind: 'local-path', filePath })

    expect(result.resource).toMatchObject({ byteLength: 11, mediaType: 'image/png' })
    expect(result.metadata).toMatchObject({ resourceId: result.resource.id, width: 20_000 })
    expect(result).not.toHaveProperty('filePath')
    await expect(fsp.readFile(resources.getFilesystemPath(result.resource.id), 'utf8'))
      .resolves.toBe('local-image')
  })

  it('元数据确认后拒绝非首发格式、16 位和 HDR，不静默降精度', async () => {
    const filePath = path.join(rootDir, 'source.avif')
    await fsp.writeFile(filePath, Buffer.from('unsupported-image'))
    const ingestor = new ImageEditorV3SourceIngestor(resources, sourceProvider())

    readMetadata.mockImplementationOnce(async (resourceId) => metadata(resourceId, {
      format: 'avif',
    }))
    await expect(ingestor.ingest({ kind: 'local-path', filePath }))
      .rejects.toThrow('仅支持 JPEG、PNG 和 WebP')

    readMetadata.mockImplementationOnce(async (resourceId) => metadata(resourceId, {
      depth: 'ushort',
      bitsPerSample: 16,
    }))
    await expect(ingestor.ingest({ kind: 'local-path', filePath }))
      .rejects.toThrow('暂不支持 16 位或浮点图片')

    readMetadata.mockImplementationOnce(async (resourceId) => metadata(resourceId, {
      hdr: true,
    }))
    await expect(ingestor.ingest({ kind: 'local-path', filePath }))
      .rejects.toThrow('暂不支持 HDR 图片')
  })

  it('HTTP(S) 手动校验每次重定向并把响应 body 增量写入资源库', async () => {
    const fetchSource = vi.fn(async (
      url: string,
      _init: RequestInit,
      _context: { resolvedAddresses: readonly string[] },
    ) => {
      if (url === 'https://example.test/start') {
        return new Response(null, { status: 302, headers: { location: '/image.png' } })
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]))
          controller.enqueue(new Uint8Array([3, 4, 5]))
          controller.close()
        },
      })
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '5' },
      })
    })
    const ingestor = new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      fetchSource,
      resolveHostname: async () => ['93.184.216.34'],
      limits: { remoteMaxBytes: 8 },
    })

    const result = await ingestor.ingest({ kind: 'http-url', url: 'https://example.test/start' })

    expect(fetchSource).toHaveBeenCalledTimes(2)
    expect(fetchSource.mock.calls[1]?.[0]).toBe('https://example.test/image.png')
    expect(fetchSource.mock.calls[1]?.[2]).toEqual({
      resolvedAddresses: ['93.184.216.34'],
      connectTimeoutMs: 10_000,
      responseHeadersTimeoutMs: 20_000,
    })
    expect(result.resource).toMatchObject({ byteLength: 5, mediaType: 'image/png' })
    await expect(resources.verify(result.resource.id)).resolves.toMatchObject({ byteLength: 5 })
  })

  it('同时防御谎报 Content-Length 和无 Content-Length 的超量流', async () => {
    const declaredTooLarge = new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      fetchSource: async () => new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'image/png', 'content-length': '9' },
      }),
      resolveHostname: async () => ['93.184.216.34'],
      limits: { remoteMaxBytes: 8 },
    })
    await expect(declaredTooLarge.ingest({ kind: 'http-url', url: 'https://example.test/image' }))
      .rejects.toThrow('exceeds maximum byte length')

    const streamingTooLarge = new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      fetchSource: async () => new Response(new Uint8Array(9), {
        headers: { 'content-type': 'application/octet-stream' },
      }),
      resolveHostname: async () => ['93.184.216.34'],
      limits: { remoteMaxBytes: 8 },
    })
    await expect(streamingTooLarge.ingest({ kind: 'http-url', url: 'https://example.test/image' }))
      .rejects.toThrow('exceeds maximum byte length')
    expect(readMetadata).not.toHaveBeenCalled()
  })

  it('拒绝非 HTTP 重定向、嵌入凭据和非图片响应', async () => {
    const redirectFetch = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'file:///etc/passwd' },
    }))
    const redirectIngestor = new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      fetchSource: redirectFetch,
      resolveHostname: async () => ['93.184.216.34'],
    })
    await expect(redirectIngestor.ingest({ kind: 'http-url', url: 'https://example.test/start' }))
      .rejects.toThrow('must use HTTP(S)')
    await expect(redirectIngestor.ingest({ kind: 'http-url', url: 'https://user:pass@example.test/a.png' }))
      .rejects.toThrow('without embedded credentials')

    const htmlIngestor = new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      fetchSource: async () => new Response('<html />', { headers: { 'content-type': 'text/html' } }),
      resolveHostname: async () => ['93.184.216.34'],
    })
    await expect(htmlIngestor.ingest({ kind: 'http-url', url: 'https://example.test/a' }))
      .rejects.toThrow('not a supported raster image')
  })

  it('每次请求和重定向都拒绝本地、私网与保留地址', async () => {
    const fetchSource = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://internal.test/image.png' },
    }))
    const resolveHostname = vi.fn(async (hostname: string) => (
      hostname === 'example.test' ? ['93.184.216.34'] : ['169.254.169.254']
    ))
    const ingestor = new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      fetchSource,
      resolveHostname,
    })

    await expect(ingestor.ingest({ kind: 'http-url', url: 'http://127.0.0.1/image.png' }))
      .rejects.toThrow('private, local, or reserved')
    await expect(new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      fetchSource,
      resolveHostname: async () => ['::ffff:127.0.0.1'],
    }).ingest({ kind: 'http-url', url: 'https://mapped.test/image.png' }))
      .rejects.toThrow('private, local, or reserved')
    await expect(new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      fetchSource,
      resolveHostname: async () => ['64:ff9b::7f00:1'],
    }).ingest({ kind: 'http-url', url: 'https://nat64.test/image.png' }))
      .rejects.toThrow('private, local, or reserved')
    await expect(ingestor.ingest({ kind: 'http-url', url: 'https://example.test/start' }))
      .rejects.toThrow('private, local, or reserved')
    expect(fetchSource).toHaveBeenCalledTimes(1)
    expect(resolveHostname).toHaveBeenCalledWith('internal.test')
  })

  it('Data URL 只接受有界、规范的 raster base64，并在预取消时不写入', async () => {
    const ingestor = new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      limits: { dataUrlMaxBytes: 4 },
    })
    const result = await ingestor.ingest({
      kind: 'data-url',
      dataUrl: `data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`,
    })
    expect(result.resource).toMatchObject({ byteLength: 3, mediaType: 'image/png' })

    await expect(ingestor.ingest({ kind: 'data-url', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }))
      .rejects.toThrow('supported raster MIME type')
    await expect(ingestor.ingest({ kind: 'data-url', dataUrl: 'data:image/png,not-base64' }))
      .rejects.toThrow('canonical base64')
    await expect(ingestor.ingest({
      kind: 'data-url',
      dataUrl: `data:image/png;base64,${Buffer.from([1, 2, 3, 4, 5]).toString('base64')}`,
    })).rejects.toThrow('exceeds maximum byte length')

    const controller = new AbortController()
    controller.abort()
    await expect(ingestor.ingest({
      kind: 'data-url',
      dataUrl: 'data:image/png;base64,AQID',
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('响应头到达后，首个响应体字节超时会取消流并清理暂存文件', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel,
    })
    const ingestor = new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      fetchSource: async () => new Response(body, { headers: { 'content-type': 'image/png' } }),
      resolveHostname: async () => ['93.184.216.34'],
      limits: { remoteBodyIdleTimeoutMs: 20, remoteTotalTimeoutMs: 1_000 },
    })

    await expect(ingestor.ingest({ kind: 'http-url', url: 'https://example.test/image.png' }))
      .rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'Remote image response body idle timed out after 20ms',
      })

    expect(cancel).toHaveBeenCalledTimes(1)
    await expect(fsp.readdir(path.join(rootDir, 'resources', '.staging'))).resolves.toEqual([])
    expect(readMetadata).not.toHaveBeenCalled()
  })

  it('响应体中途停顿超过 idle 预算时不保留半写入对象', async () => {
    let reads = 0
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1
        if (reads === 1) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          return
        }
        return new Promise<void>(() => undefined)
      },
      cancel,
    })
    const ingestor = new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      fetchSource: async () => new Response(body, { headers: { 'content-type': 'image/png' } }),
      resolveHostname: async () => ['93.184.216.34'],
      limits: { remoteBodyIdleTimeoutMs: 20, remoteTotalTimeoutMs: 1_000 },
    })

    await expect(ingestor.ingest({ kind: 'http-url', url: 'https://example.test/image.png' }))
      .rejects.toThrow('response body idle timed out')

    expect(cancel).toHaveBeenCalledTimes(1)
    await expect(fsp.readdir(path.join(rootDir, 'resources', '.staging'))).resolves.toEqual([])
    expect(readMetadata).not.toHaveBeenCalled()
  })

  it('远程导入总预算可以终止不响应 AbortSignal 的请求阶段', async () => {
    let requestSignal: AbortSignal | null = null
    const ingestor = new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      fetchSource: async (_url, init) => {
        requestSignal = init.signal ?? null
        return new Promise<Response>(() => undefined)
      },
      resolveHostname: async () => ['93.184.216.34'],
      limits: { remoteTotalTimeoutMs: 20 },
    })

    await expect(ingestor.ingest({ kind: 'http-url', url: 'https://example.test/image.png' }))
      .rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'Remote image total import timed out after 20ms',
      })
    expect((requestSignal as unknown as AbortSignal).aborted).toBe(true)
    expect(readMetadata).not.toHaveBeenCalled()
  })

  it('调用方取消会传递到当前跳请求和响应体，并优先保留 AbortError 语义', async () => {
    const controller = new AbortController()
    let requestSignal: AbortSignal | null = null
    const cancel = vi.fn()
    const ingestor = new ImageEditorV3SourceIngestor(resources, sourceProvider(), {
      fetchSource: async (_url, init) => {
        requestSignal = init.signal ?? null
        return new Response(new ReadableStream<Uint8Array>({
          pull: () => new Promise<void>(() => undefined),
          cancel,
        }), { headers: { 'content-type': 'image/png' } })
      },
      resolveHostname: async () => ['93.184.216.34'],
      limits: { remoteBodyIdleTimeoutMs: 1_000, remoteTotalTimeoutMs: 2_000 },
    })
    const pending = ingestor.ingest(
      { kind: 'http-url', url: 'https://example.test/image.png' },
      controller.signal,
    )
    await vi.waitFor(() => expect(requestSignal).not.toBeNull())

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect((requestSignal as unknown as AbortSignal).aborted).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    await expect(fsp.readdir(path.join(rootDir, 'resources', '.staging'))).resolves.toEqual([])
  })
})
