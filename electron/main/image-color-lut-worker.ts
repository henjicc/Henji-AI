import { parentPort, workerData } from 'node:worker_threads'
import { parseCubeLut } from '../../src/core/imaging/lut/cube'
import { decodeStandardRgb, type SourceRgbConversionRequest } from './services/image-editor-v3/source-rgb-conversion'
try {
  if (workerData instanceof Uint8Array) {
    parseCubeLut(new TextDecoder().decode(workerData))
    parentPort?.postMessage({ ok: true })
  } else {
    const request = workerData as SourceRgbConversionRequest
    if (request?.type !== 'source-rgb.convert' || !(request.bytes instanceof Uint8Array)
      || !['srgb', 'display-p3'].includes(request.space) || ![8, 16, 32].includes(request.bitDepth)) throw new Error('图片颜色转换参数无效')
    const pixels = decodeStandardRgb(request.bytes, request.space, request.bitDepth)
    if (!(pixels.buffer instanceof ArrayBuffer)) throw new Error('图片像素缓冲无法移交')
    parentPort?.postMessage({ ok: true, pixels }, [pixels.buffer])
  }
} catch (error) {
  parentPort?.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) })
}
