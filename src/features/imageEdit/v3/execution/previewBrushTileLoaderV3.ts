import {
  createImageEditorV3RequestId,
  readImageEditorV3BrushTiles,
} from '@/commands/imageEditorV3'
import type {
  ImageEditBrushResourceReferenceV3,
  ImageEditBrushTileV3,
} from '@/core/imageEdit/v3/brush/contracts'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3 } from '@/core/imageEdit/v3/colorTypes'
import type { ImageEditorPreviewBrushResourceRequestV3 } from './previewDocumentV3'
import type { ImageEditorPreviewBrushTileV3 } from './previewProtocolV3'

export const IMAGE_EDITOR_PREVIEW_BRUSH_CACHE_MAX_BYTES_V3 = 64 * 1024 * 1024
export const IMAGE_EDITOR_PREVIEW_BRUSH_TRANSFER_MAX_BYTES_V3 = 128 * 1024 * 1024
const BRUSH_TILE_BATCH_MAX_BYTES = 32 * 1024 * 1024
const BRUSH_TILE_BATCH_MAX_COUNT = 16

export type ImageEditorPreviewBrushTileReaderV3 = (
  request: {
    requestId: string
    tiles: ReadonlyArray<{
      tileKey: string
      resource: ImageEditBrushResourceReferenceV3
    }>
  },
  signal?: AbortSignal,
) => Promise<{ tiles: Array<{ tileKey: string; tile: ImageEditBrushTileV3 }> }>

interface CachedPreviewBrushTileV3 {
  storage: ImageEditorPreviewBrushResourceRequestV3['storage']
  width: number
  height: number
  data: Float32Array
}

interface ImageEditorPreviewBrushTileLoaderOptionsV3 {
  reader?: ImageEditorPreviewBrushTileReaderV3
  cacheMaxBytes?: number
  transferMaxBytes?: number
}

function abortError(signal: AbortSignal): Error {
  const error = signal.reason instanceof Error
    ? signal.reason
    : new Error('图片预览资源读取已取消')
  if (error.name === 'Error') error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  let onAbort: (() => void) | undefined
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([operation, cancelled])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function decodedBytes(request: ImageEditorPreviewBrushResourceRequestV3): number {
  return request.width * request.height
    * (request.storage === 'rgba-float32' ? 4 : 1)
    * Float32Array.BYTES_PER_ELEMENT
}

function cacheKey(
  request: ImageEditorPreviewBrushResourceRequestV3,
  document: ImageEditDocumentV3,
): string {
  return [
    request.resourceId,
    request.byteLength,
    `${request.width}x${request.height}`,
    request.storage,
    document.color.workingSpace,
    document.color.transferFunction,
  ].join(':')
}

function validateLoadedTile(
  request: ImageEditorPreviewBrushResourceRequestV3,
  tile: ImageEditBrushTileV3,
  document: ImageEditDocumentV3,
  signal: AbortSignal,
): void {
  const exactBuffer = tile.data.buffer instanceof ArrayBuffer
    && tile.data.byteOffset === 0
    && tile.data.byteLength === tile.data.buffer.byteLength
  if (tile.storage !== request.storage
    || tile.width !== request.width
    || tile.height !== request.height
    || tile.width > 512
    || tile.height > 512
    || !(tile.data instanceof Float32Array)
    || !exactBuffer
    || tile.data.byteLength !== decodedBytes(request)) {
    throw new Error(`图片预览画笔瓦片像素契约与文档不匹配：${request.tileKey}`)
  }
  if (tile.storage === 'mask-float32') {
    for (let offset = 0; offset < tile.data.length; offset += 1) {
      if ((offset & 0xffff) === 0) throwIfAborted(signal)
      const value = tile.data[offset]
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`图片预览蒙版瓦片包含无效值：${request.tileKey}`)
      }
    }
    return
  }
  if (tile.colorDomain !== 'linear-light'
    || tile.workingSpace !== document.color.workingSpace
    || tile.transferFunction !== document.color.transferFunction
    || tile.referenceWhiteNits !== (document.color.hdrMetadata?.referenceWhiteNits
      ?? IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3)
    || tile.alpha !== 'premultiplied') {
    throw new Error(`图片预览栅格瓦片颜色契约与文档不匹配：${request.tileKey}`)
  }
  for (let offset = 0; offset < tile.data.length; offset += 4) {
    if ((offset & 0xffff) === 0) throwIfAborted(signal)
    const alpha = tile.data[offset + 3]
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new Error(`图片预览画笔瓦片包含无效 Alpha：${request.tileKey}`)
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const value = tile.data[offset + channel]
      if (!Number.isFinite(value) || (alpha === 0 && value !== 0)) {
        throw new Error(`图片预览画笔瓦片包含无效预乘 RGBA：${request.tileKey}`)
      }
    }
  }
}

function createBatches(
  requests: readonly ImageEditorPreviewBrushResourceRequestV3[],
): ImageEditorPreviewBrushResourceRequestV3[][] {
  const batches: ImageEditorPreviewBrushResourceRequestV3[][] = []
  let batch: ImageEditorPreviewBrushResourceRequestV3[] = []
  let batchBytes = 0
  let batchKeys = new Set<string>()
  for (const request of requests) {
    const bytes = decodedBytes(request)
    if (batch.length > 0 && (
      batch.length >= BRUSH_TILE_BATCH_MAX_COUNT
      || batchBytes + bytes > BRUSH_TILE_BATCH_MAX_BYTES
      || batchKeys.has(request.tileKey)
    )) {
      batches.push(batch)
      batch = []
      batchBytes = 0
      batchKeys = new Set<string>()
    }
    batch.push(request)
    batchBytes += bytes
    batchKeys.add(request.tileKey)
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

export class ImageEditorPreviewBrushTileLoaderV3 {
  private readonly cache = new Map<string, CachedPreviewBrushTileV3>()
  private cacheBytes = 0
  private readonly reader: ImageEditorPreviewBrushTileReaderV3
  private readonly cacheMaxBytes: number
  private readonly transferMaxBytes: number

  constructor(options: ImageEditorPreviewBrushTileLoaderOptionsV3 = {}) {
    this.reader = options.reader ?? readImageEditorV3BrushTiles
    this.cacheMaxBytes = options.cacheMaxBytes ?? IMAGE_EDITOR_PREVIEW_BRUSH_CACHE_MAX_BYTES_V3
    this.transferMaxBytes = options.transferMaxBytes
      ?? IMAGE_EDITOR_PREVIEW_BRUSH_TRANSFER_MAX_BYTES_V3
    if (!Number.isSafeInteger(this.cacheMaxBytes) || this.cacheMaxBytes < 0) {
      throw new Error('图片预览画笔缓存上限必须是非负整数')
    }
    if (!Number.isSafeInteger(this.transferMaxBytes) || this.transferMaxBytes < 0) {
      throw new Error('图片预览画笔传输上限必须是非负整数')
    }
  }

  async load(
    requests: readonly ImageEditorPreviewBrushResourceRequestV3[],
    document: ImageEditDocumentV3,
    signal: AbortSignal,
  ): Promise<ImageEditorPreviewBrushTileV3[]> {
    const transferBytes = requests.reduce((total, request) => total + decodedBytes(request), 0)
    if (!Number.isSafeInteger(transferBytes) || transferBytes > this.transferMaxBytes) {
      throw new Error('图片预览画笔瓦片超过单帧受控传输上限')
    }
    const resolved = new Map<string, CachedPreviewBrushTileV3>()
    const missing: ImageEditorPreviewBrushResourceRequestV3[] = []
    for (const request of requests) {
      const key = cacheKey(request, document)
      const cached = this.readCache(key)
      if (cached) resolved.set(key, cached)
      else missing.push(request)
    }
    for (const [batchIndex, batch] of createBatches(missing).entries()) {
      throwIfAborted(signal)
      const result = await raceWithAbort(this.reader({
        requestId: createImageEditorV3RequestId(`preview-brush-${batchIndex}`),
        tiles: batch.map((request) => ({
          tileKey: request.tileKey,
          resource: { resourceId: request.resourceId, byteSize: request.byteLength },
        })),
      }, signal), signal)
      if (result.tiles.length !== batch.length) {
        throw new Error('图片预览画笔瓦片读取结果数量不匹配')
      }
      const returned = new Map<string, ImageEditBrushTileV3>()
      for (const item of result.tiles) {
        if (returned.has(item.tileKey)
          || !batch.some((request) => request.tileKey === item.tileKey)) {
          throw new Error(`图片预览画笔瓦片返回了重复或未请求的键：${item.tileKey}`)
        }
        returned.set(item.tileKey, item.tile)
      }
      for (const request of batch) {
        const tile = returned.get(request.tileKey)
        if (!tile) throw new Error(`图片预览画笔瓦片读取结果缺失：${request.tileKey}`)
        validateLoadedTile(request, tile, document, signal)
        const cached = {
          storage: request.storage,
          width: tile.width,
          height: tile.height,
          data: tile.data,
        }
        const key = cacheKey(request, document)
        resolved.set(key, cached)
        this.insertCache(key, cached)
      }
    }
    return requests.map((request) => {
      const cached = resolved.get(cacheKey(request, document))
      if (!cached) throw new Error(`图片预览画笔瓦片未解析：${request.tileKey}`)
      return {
        resourceId: request.resourceId,
        storage: cached.storage,
        width: cached.width,
        height: cached.height,
        bytes: cached.data.slice().buffer as ArrayBuffer,
      }
    })
  }

  dispose(): void {
    this.cache.clear()
    this.cacheBytes = 0
  }

  private readCache(key: string): CachedPreviewBrushTileV3 | undefined {
    const tile = this.cache.get(key)
    if (!tile) return undefined
    this.cache.delete(key)
    this.cache.set(key, tile)
    return tile
  }

  private insertCache(key: string, tile: CachedPreviewBrushTileV3): void {
    const previous = this.cache.get(key)
    if (previous) this.cacheBytes -= previous.data.byteLength
    this.cache.delete(key)
    this.cache.set(key, tile)
    this.cacheBytes += tile.data.byteLength
    while (this.cacheBytes > this.cacheMaxBytes && this.cache.size > 0) {
      const oldestKey = this.cache.keys().next().value as string | undefined
      if (!oldestKey) break
      const oldest = this.cache.get(oldestKey)
      this.cache.delete(oldestKey)
      this.cacheBytes -= oldest?.data.byteLength ?? 0
    }
  }
}
