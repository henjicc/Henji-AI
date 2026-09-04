import { createLogger } from '@/core/logging'
import type {
  ImageEditorV3DialogResult,
  ImageEditorV3ManagedRasterExportResult,
  ImageEditorV3Platform,
  ImageEditorV3RasterExportDescription,
  ImageEditorV3RasterExportFormat,
  ImageEditorV3RasterExportResult,
  ImageEditorV3RasterPublication,
  ImageEditorV3StandaloneRasterExportResult,
} from '@/platform/contracts/imageEditorV3'
import { getPlatform } from '@/platform/runtime'
import { createImageEditorV3RequestId } from './imageEditorV3'

const logger = createLogger('commands.image_editor_v3.export')

export interface ImageEditorV3RenderedExportTile {
  x: number
  y: number
  width: number
  height: number
  rowStride: number
  pixels: ArrayBuffer | Uint8Array
}

export interface ImageEditorV3RestartableExportTileStream
  extends AsyncIterable<ImageEditorV3RenderedExportTile> {
  /** 仅渲染后端失败时调用；返回从 tile 0 开始的完整 CPU 真值流。 */
  createCpuFallback(error: Error): AsyncIterable<ImageEditorV3RenderedExportTile>
}

export interface ExportImageEditorV3RasterRequest {
  documentRef: Parameters<ImageEditorV3Platform['startRasterExport']>[0]['documentRef']
  revision: number
  sourceFingerprint: `sha256:${string}`
  format: ImageEditorV3RasterExportFormat
  description: ImageEditorV3RasterExportDescription
  tiles: AsyncIterable<ImageEditorV3RenderedExportTile> | Iterable<ImageEditorV3RenderedExportTile>
  suggestedName?: string
  tileSize?: number
  compressionLevel?: number
  quality?: number
  effort?: number
}

export type MaterializeImageEditorV3RasterRequest = Omit<
  ExportImageEditorV3RasterRequest,
  'suggestedName'
>

type ImageEditorV3MaterializedRasterResult =
  | ImageEditorV3ManagedRasterExportResult
  | ImageEditorV3StandaloneRasterExportResult

function abortError(): Error {
  const error = new Error('图片栅格导出已取消')
  error.name = 'AbortError'
  return error
}

function exactArrayBuffer(value: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value
  if (!(value.buffer instanceof ArrayBuffer)) throw new Error('栅格导出不支持共享像素缓冲区')
  if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) return value.buffer
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
}

class ImageEditorV3TileRenderError extends Error {
  override readonly name = 'ImageEditorV3TileRenderError'

  constructor(readonly renderCause: Error) {
    super(renderCause.message, { cause: renderCause })
  }
}

function isRestartableTileStream(
  tiles: ExportImageEditorV3RasterRequest['tiles'],
): tiles is ImageEditorV3RestartableExportTileStream {
  return typeof (tiles as Partial<ImageEditorV3RestartableExportTileStream>).createCpuFallback
    === 'function'
}

async function writeRenderedTiles(
  platform: ImageEditorV3Platform,
  sessionId: string,
  tiles: AsyncIterable<ImageEditorV3RenderedExportTile> | Iterable<ImageEditorV3RenderedExportTile>,
  signal?: AbortSignal,
): Promise<number> {
  const iterator = (tiles as AsyncIterable<ImageEditorV3RenderedExportTile>)[Symbol.asyncIterator]?.()
    ?? (tiles as Iterable<ImageEditorV3RenderedExportTile>)[Symbol.iterator]()
  let written = 0
  try {
    for (;;) {
      let next: IteratorResult<ImageEditorV3RenderedExportTile>
      try {
        next = await iterator.next()
      } catch (error) {
        throw new ImageEditorV3TileRenderError(
          error instanceof Error ? error : new Error(String(error)),
        )
      }
      if (next.done) return written
      if (signal?.aborted) throw abortError()
      await platform.writeRasterExportTile({
        sessionId,
        tile: {
          x: next.value.x,
          y: next.value.y,
          width: next.value.width,
          height: next.value.height,
          rowStride: next.value.rowStride,
          pixels: exactArrayBuffer(next.value.pixels),
        },
      })
      written += 1
    }
  } finally {
    await Promise.resolve(iterator.return?.()).catch(() => undefined)
  }
}

async function writeWithRenderBackendRetry(
  platform: ImageEditorV3Platform,
  initialSessionId: string,
  tiles: ExportImageEditorV3RasterRequest['tiles'],
  signal?: AbortSignal,
  onSessionChanged?: (sessionId: string) => void,
): Promise<string> {
  try {
    await writeRenderedTiles(platform, initialSessionId, tiles, signal)
    return initialSessionId
  } catch (error) {
    if (!(error instanceof ImageEditorV3TileRenderError)) throw error
    if (!isRestartableTileStream(tiles) || error.renderCause.name === 'AbortError') {
      throw error.renderCause
    }
    logger.warn('GPU 导出失败，已清理旧暂存并从 tile 0 使用 CPU 重建', {
      event: 'image_editor_v3.raster_export.backend_retry',
      requestId: initialSessionId,
      context: { reason: error.renderCause.message },
    })
    const restarted = await platform.restartRasterExport({ sessionId: initialSessionId })
    onSessionChanged?.(restarted.sessionId)
    await writeRenderedTiles(
      platform,
      restarted.sessionId,
      tiles.createCpuFallback(error.renderCause),
      signal,
    )
    return restarted.sessionId
  }
}

/**
 * 上层只看到一次导出调用；内部逐瓦片送入主进程的原子输出会话，不会拼出全帧 RGBA。
 */
export async function exportImageEditorV3Raster(
  request: ExportImageEditorV3RasterRequest,
  signal?: AbortSignal,
): Promise<ImageEditorV3DialogResult<ImageEditorV3RasterExportResult>> {
  if (signal?.aborted) throw abortError()
  const platform = getPlatform().imageEditorV3
  const requestId = createImageEditorV3RequestId('raster-export')
  let sessionId: string | undefined
  const cancelActive = (): void => {
    const cancellation = sessionId
      ? platform.cancelRasterExport({ sessionId })
      : platform.cancelRequest(requestId)
    void cancellation.catch((error: unknown) => {
      logger.warn('图片栅格导出取消请求发送失败', {
        event: 'image_editor_v3.raster_export.cancel_failed',
        requestId: sessionId ?? requestId,
        context: { error: error instanceof Error ? error.message : String(error) },
      })
    })
  }
  signal?.addEventListener('abort', cancelActive, { once: true })
  try {
    const started = await platform.startRasterExport({
      requestId,
      documentRef: request.documentRef,
      revision: request.revision,
      sourceFingerprint: request.sourceFingerprint,
      format: request.format,
      description: request.description,
      suggestedName: request.suggestedName,
      tileSize: request.tileSize,
      compressionLevel: request.compressionLevel,
      quality: request.quality,
      effort: request.effort,
    })
    if (started.status === 'cancelled') return started
    sessionId = started.value.sessionId
    if (signal?.aborted) {
      await platform.cancelRasterExport({ sessionId })
      throw abortError()
    }
    try {
      sessionId = await writeWithRenderBackendRetry(
        platform,
        sessionId,
        request.tiles,
        signal,
        (nextSessionId) => { sessionId = nextSessionId },
      )
      return {
        status: 'completed',
        value: await platform.completeRasterExport({ sessionId }),
      }
    } catch (error) {
      await platform.cancelRasterExport({ sessionId }).catch(() => undefined)
      throw error
    }
  } finally {
    signal?.removeEventListener('abort', cancelActive)
  }
}

/**
 * 与“另存为”共享同一逐瓦片传输，但输出位置完全由主进程管理。完成时，主进程会把
 * 编码文件写入内容寻址资源库并原子挂到同一文档 revision，渲染层不会接触本地路径。
 */
export async function materializeImageEditorV3Raster(
  request: MaterializeImageEditorV3RasterRequest,
  signal?: AbortSignal,
): Promise<ImageEditorV3ManagedRasterExportResult> {
  const completed = await materializeManagedImageEditorV3Raster(
    request,
    'document-preview',
    signal,
  )
  if (completed.publication !== 'document-preview') {
    throw new Error('文档预览物化收到了独立图片结果')
  }
  return completed
}

async function materializeManagedImageEditorV3Raster(
  request: MaterializeImageEditorV3RasterRequest,
  publication: ImageEditorV3RasterPublication,
  signal?: AbortSignal,
): Promise<ImageEditorV3MaterializedRasterResult> {
  if (signal?.aborted) throw abortError()
  const platform = getPlatform().imageEditorV3
  const standalone = publication === 'standalone-image'
  const requestId = createImageEditorV3RequestId(
    standalone ? 'raster-materialize-standalone' : 'raster-materialize',
  )
  let sessionId: string | undefined
  const cancelActive = (): void => {
    const cancellation = sessionId
      ? platform.cancelRasterExport({ sessionId })
      : platform.cancelRequest(requestId)
    void cancellation.catch((error: unknown) => {
      logger.warn(
        standalone
          ? '图片独立栅格物化取消请求发送失败'
          : '图片受管栅格物化取消请求发送失败',
        {
          event: standalone
            ? 'image_editor_v3.raster_materialize_standalone.cancel_failed'
            : 'image_editor_v3.raster_materialize.cancel_failed',
          requestId: sessionId ?? requestId,
          context: { error: error instanceof Error ? error.message : String(error) },
        },
      )
    })
  }
  signal?.addEventListener('abort', cancelActive, { once: true })
  try {
    const started = await platform.startManagedRasterExport({
      requestId,
      documentRef: request.documentRef,
      revision: request.revision,
      sourceFingerprint: request.sourceFingerprint,
      format: request.format,
      description: request.description,
      tileSize: request.tileSize,
      compressionLevel: request.compressionLevel,
      quality: request.quality,
      effort: request.effort,
      publication,
    })
    sessionId = started.sessionId
    if (signal?.aborted) {
      await platform.cancelRasterExport({ sessionId })
      throw abortError()
    }
    try {
      sessionId = await writeWithRenderBackendRetry(
        platform,
        sessionId,
        request.tiles,
        signal,
        (nextSessionId) => { sessionId = nextSessionId },
      )
      return await platform.completeManagedRasterExport({ sessionId })
    } catch (error) {
      await platform.cancelRasterExport({ sessionId }).catch(() => undefined)
      throw error
    }
  } finally {
    signal?.removeEventListener('abort', cancelActive)
  }
}

/**
 * 与文档预览物化共享同一流式编码会话，但发布为画布可接管的普通受管图片。
 * 它不改写原 V3 文档的 previewRef、revision 或历史。
 */
export async function materializeImageEditorV3StandaloneRaster(
  request: MaterializeImageEditorV3RasterRequest,
  signal?: AbortSignal,
): Promise<ImageEditorV3StandaloneRasterExportResult> {
  const completed = await materializeManagedImageEditorV3Raster(
    request,
    'standalone-image',
    signal,
  )
  if (completed.publication !== 'standalone-image') {
    throw new Error('独立图片物化收到了文档预览结果')
  }
  return completed
}
