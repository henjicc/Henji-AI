import { createLogger } from '@/core/logging'
import type {
  ImageEditorV3DialogResult,
  ImageEditorV3ManagedRasterExportResult,
  ImageEditorV3Platform,
  ImageEditorV3RasterExportDescription,
  ImageEditorV3RasterExportFormat,
  ImageEditorV3RasterExportResult,
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
      for await (const tile of request.tiles) {
        if (signal?.aborted) throw abortError()
        await platform.writeRasterExportTile({
          sessionId,
          tile: {
            x: tile.x,
            y: tile.y,
            width: tile.width,
            height: tile.height,
            rowStride: tile.rowStride,
            pixels: exactArrayBuffer(tile.pixels),
          },
        })
      }
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
  if (signal?.aborted) throw abortError()
  const platform = getPlatform().imageEditorV3
  const requestId = createImageEditorV3RequestId('raster-materialize')
  let sessionId: string | undefined
  const cancelActive = (): void => {
    const cancellation = sessionId
      ? platform.cancelRasterExport({ sessionId })
      : platform.cancelRequest(requestId)
    void cancellation.catch((error: unknown) => {
      logger.warn('图片受管栅格物化取消请求发送失败', {
        event: 'image_editor_v3.raster_materialize.cancel_failed',
        requestId: sessionId ?? requestId,
        context: { error: error instanceof Error ? error.message : String(error) },
      })
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
    })
    sessionId = started.sessionId
    if (signal?.aborted) {
      await platform.cancelRasterExport({ sessionId })
      throw abortError()
    }
    try {
      for await (const tile of request.tiles) {
        if (signal?.aborted) throw abortError()
        await platform.writeRasterExportTile({
          sessionId,
          tile: {
            x: tile.x,
            y: tile.y,
            width: tile.width,
            height: tile.height,
            rowStride: tile.rowStride,
            pixels: exactArrayBuffer(tile.pixels),
          },
        })
      }
      return await platform.completeManagedRasterExport({ sessionId })
    } catch (error) {
      await platform.cancelRasterExport({ sessionId }).catch(() => undefined)
      throw error
    }
  } finally {
    signal?.removeEventListener('abort', cancelActive)
  }
}
