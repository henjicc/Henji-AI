const DEFAULT_REQUEST_BYTES = 16 * 1024 * 1024
export const IMAGE_EDITOR_V3_REQUEST_BUDGET_BYTES = 1_280 * 1024 * 1024
const MAX_ACTIVE_REQUESTS = 12
// 完整多图层编辑器会并行持有文档读取、金字塔预热、受管预览以及两批视口瓦片。
// 组合上限必须容纳这条正式链路；内存硬预算与每类操作上限继续限制实际工作集。
const MAX_ACTIVE_REQUESTS_PER_SENDER = 6

const OPERATION_LIMITS_PER_SENDER: Readonly<Record<string, number>> = {
  'source.import': 1,
  'source.ingest': 1,
  'source.pyramid_prewarm': 1,
  'source.tile': 2,
  'source.tile_batch': 2,
  'brush_tiles.persist': 1,
  'brush_tiles.read': 2,
  'package.open': 1,
  'package.save_as': 1,
  'raster_export.start': 1,
}

interface ActiveImageEditorV3Request {
  controller: AbortController
  senderId: number
  operation: string
  estimatedBytes: number
}

export interface ImageEditorV3RequestTicket {
  signal: AbortSignal
  release(): void
}

function requestKey(senderId: number, requestId: string): string {
  return `${senderId}:${requestId}`
}

export class ImageEditorV3RequestAdmission {
  private readonly active = new Map<string, ActiveImageEditorV3Request>()
  private admittedBytes = 0

  admit(
    operation: string,
    requestId: string,
    senderId: number,
    estimatedBytes = DEFAULT_REQUEST_BYTES,
  ): ImageEditorV3RequestTicket {
    if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes < 0) {
      throw new Error('Invalid image editor request memory estimate')
    }
    const key = requestKey(senderId, requestId)
    if (this.active.has(key)) throw new Error(`Image editor request already active: ${requestId}`)
    const senderRequests = [...this.active.values()].filter((request) => request.senderId === senderId)
    if (this.active.size >= MAX_ACTIVE_REQUESTS
      || senderRequests.length >= MAX_ACTIVE_REQUESTS_PER_SENDER) {
      throw new Error('Image editor request concurrency limit reached')
    }
    const operationLimit = OPERATION_LIMITS_PER_SENDER[operation]
    if (operationLimit !== undefined
      && senderRequests.filter((request) => request.operation === operation).length >= operationLimit) {
      throw new Error(`Image editor ${operation} concurrency limit reached`)
    }
    if (estimatedBytes > IMAGE_EDITOR_V3_REQUEST_BUDGET_BYTES - this.admittedBytes) {
      throw new Error('Image editor request memory budget exceeded')
    }
    const controller = new AbortController()
    const active: ActiveImageEditorV3Request = {
      controller,
      senderId,
      operation,
      estimatedBytes,
    }
    this.active.set(key, active)
    this.admittedBytes += estimatedBytes
    let released = false
    return {
      signal: controller.signal,
      release: () => {
        if (released) return
        released = true
        if (this.active.get(key) !== active) return
        this.active.delete(key)
        this.admittedBytes -= estimatedBytes
      },
    }
  }

  cancel(senderId: number, requestId: string): boolean {
    const request = this.active.get(requestKey(senderId, requestId))
    if (!request) return false
    request.controller.abort()
    return true
  }

  abortSender(senderId: number): void {
    for (const request of this.active.values()) {
      if (request.senderId === senderId) request.controller.abort()
    }
  }

  abortAll(): void {
    for (const request of this.active.values()) request.controller.abort()
    this.active.clear()
    this.admittedBytes = 0
  }

  getSnapshot(): { activeRequests: number; admittedBytes: number } {
    return { activeRequests: this.active.size, admittedBytes: this.admittedBytes }
  }
}

export function estimateImageEditorV3TileRequestBytes(request: {
  halo: number
  bitDepth?: 8 | 16 | 32
}): number {
  const side = 512 + request.halo * 2
  const bytesPerSample = (request.bitDepth ?? 8) / 8
  // libvips 输出、主进程精确 ArrayBuffer 与 IPC structured clone 同时在途。
  return side * side * 4 * bytesPerSample * 3
}

export function estimateImageEditorV3TileBatchRequestBytes(
  tiles: readonly { halo: number; bitDepth?: 8 | 16 | 32 }[],
): number {
  const total = tiles.reduce(
    (bytes, tile) => bytes + estimateImageEditorV3TileRequestBytes(tile),
    0,
  )
  if (!Number.isSafeInteger(total)) throw new Error('Invalid image editor tile batch estimate')
  return total
}

export function estimateImageEditorV3ProxyRequestBytes(maxDimension: number): number {
  // 解码工作表面 + 编码代理 + IPC 副本；按 RGBA 上界预留。
  return maxDimension * maxDimension * 4 + 16 * 1024 * 1024
}

export function estimateImageEditorV3PyramidPrewarmBytes(bitDepth: 8 | 16 | 32 = 8): number {
  // 预热严格串行；只需为一个解码瓦片、缓存发布副本与 libvips 工作区准入。
  return estimateImageEditorV3TileRequestBytes({ halo: 0, bitDepth }) + 16 * 1024 * 1024
}

export function estimateImageEditorV3BrushPersistBytes(rawByteLength: number): number {
  // IPC 输入、codec 小端副本/压缩缓冲与资源库 staging 同时在途。
  return rawByteLength * 3 + 8 * 1024 * 1024
}

export function estimateImageEditorV3BrushReadBytes(
  resourceByteLength: number,
  maximumDecodedByteLength: number,
): number {
  // 批次结果必须保留到 IPC 返回；另预留单瓦片解压副本和 IPC structured clone。
  return resourceByteLength * 2 + maximumDecodedByteLength * 2 + 8 * 1024 * 1024
}
