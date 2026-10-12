import { createMainLogger } from '../logging'
import { isMarkedAsUntransferable } from 'node:worker_threads'
import { runImageColorWorker } from './color-lut-validation'
import type { SourceRgbConversionRequest } from './source-rgb-conversion'

const logger = createMainLogger('main.image_editor_v3.source_color')

export async function decodeStandardRgbInWorker(bytes: Buffer, space: SourceRgbConversionRequest['space'], bitDepth: SourceRgbConversionRequest['bitDepth'], signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted()
  const started = performance.now()
  const inputBytes = bytes.byteLength
  // Sharp 返回的 native 外部内存不能被 V8 转移，即使覆盖完整 ArrayBuffer。
  // 先复制到 V8 独占内存，再以 transferList 移交；结果缓冲直接转回，不经结构化复制。
  const input = bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    && !isMarkedAsUntransferable(bytes.buffer) ? new Uint8Array(bytes.buffer) : Uint8Array.from(bytes)
  const request: SourceRgbConversionRequest = { type: 'source-rgb.convert', bytes: input, space, bitDepth }
  logger.debug('开始转换图片源颜色', { event: 'image_editor_v3.source.color.start', context: { bytes: inputBytes, space, bitDepth } })
  try {
    const operation = runImageColorWorker(request, [input.buffer], signal)
    const mainDispatchMs = performance.now() - started
    const reply = await operation
    signal?.throwIfAborted()
    if (!reply || typeof reply !== 'object' || !('pixels' in reply) || !(reply.pixels instanceof Uint8Array)
      || reply.pixels.byteLength !== inputBytes / 2 * (bitDepth / 8)) throw new Error('图片颜色处理返回的像素长度无效')
    logger.debug('图片源颜色转换完成', { event: 'image_editor_v3.source.color.completed', context: { mainDispatchMs, elapsedMs: performance.now() - started, bytes: inputBytes } })
    return Buffer.from(reply.pixels.buffer, reply.pixels.byteOffset, reply.pixels.byteLength)
  } catch (error) {
    logger.warn('图片源颜色转换未完成', { event: signal?.aborted ? 'image_editor_v3.source.color.cancelled' : 'image_editor_v3.source.color.failed', error })
    throw error
  }
}
