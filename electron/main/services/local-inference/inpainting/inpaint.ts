import { loadSharp } from '../../image/sharp-loader'
import { loadTrackingOpenCv } from '../tracking/openCvTracking'
import type { LocalModelRunner, LocalTensorInput } from '../analysis'
import type { LocalInferenceFailureCode } from '../protocol'
import type { LocalInferenceLog } from '../providers'
import { assertInpaintRoi, type ImageInpaintJob, type ImageInpaintResult } from './protocol'

const SIZE = 512 // 两份神经网络的训练/导出工作尺寸；不是源图尺寸上限。
export class ImageInpaintError extends Error {
  constructor(readonly code: LocalInferenceFailureCode, message: string, options?: ErrorOptions) { super(message, options); this.name = 'ImageInpaintError' }
}
export interface ImageInpaintDependencies {
  openModel: (model: NonNullable<ImageInpaintJob['model']>, providers: ImageInpaintJob['providers'], shape: string) => Promise<LocalModelRunner>
  signal: AbortSignal
  progress(done: number, total: number): void
  log: LocalInferenceLog
}
function check(signal: AbortSignal): void {
  if (signal.aborted) throw new ImageInpaintError('cancelled', '图片修补已取消。')
}

/** 已有 OpenCV/WASM；小瑕疵按原 ROI 分辨率处理，不引入 Python 或新的原生程序。 */
async function classic(rgb: Uint8Array, mask: Uint8Array, width: number, height: number, method: 'telea' | 'ns'): Promise<Uint8Array> {
  const { cv } = await loadTrackingOpenCv()
  const source = cv.matFromArray(height, width, cv.CV_8UC3, rgb)
  const selection = cv.matFromArray(height, width, cv.CV_8UC1, mask)
  const output = new cv.Mat()
  try {
    cv.inpaint(source, selection, output, 3, method === 'telea' ? cv.INPAINT_TELEA : cv.INPAINT_NS)
    return new Uint8Array(output.data)
  } finally { source.delete(); selection.delete(); output.delete() }
}

/** utility process 唯一修补内核；读/写 PNG 与像素循环也留在隔离进程。 */
export async function runImageInpaint(job: ImageInpaintJob, deps: ImageInpaintDependencies): Promise<ImageInpaintResult> {
  const start = performance.now()
  let stage: LocalInferenceFailureCode = 'decode'
  const context = { requestId: job.id, algorithm: job.algorithm, quality: job.quality }
  deps.log('info', '图片修补开始', 'local_inference.inpaint.start', context)
  try {
    check(deps.signal)
    assertInpaintRoi(job.roi)
    if (!['fast', 'fine', 'blemish'].includes(job.quality) || !['migan', 'lama', 'telea', 'ns'].includes(job.algorithm)) throw new Error('图片修补质量档或算法无效。')
    const sharp = await loadSharp()
    const source = sharp(job.sourcePath).autoOrient()
    const [metadata, maskMetadata] = await Promise.all([source.metadata(), sharp(job.maskPath).metadata()])
    const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1)
    const width = rotated ? metadata.height : metadata.width
    const height = rotated ? metadata.width : metadata.height
    if (!width || !height || maskMetadata.width !== width || maskMetadata.height !== height
      || maskMetadata.channels !== 1 || maskMetadata.depth !== 'uchar') throw new Error('mask 必须是与正向源图同尺寸的 8 位单通道灰度遮罩。')
    if (metadata.depth !== 'uchar' || !['srgb', 'b-w'].includes(metadata.space ?? '') || metadata.icc) throw new Error('本地修补首版仅接受无 ICC 的 8 位 SDR/sRGB 源图；请由领域层先做明确颜色转换。')
    assertInpaintRoi(job.roi, width, height)
    const [rgba, coverage] = await Promise.all([
      source.extract(job.roi).toColourspace('srgb').ensureAlpha().raw().toBuffer(),
      sharp(job.maskPath).extract(job.roi).toColourspace('b-w').raw().toBuffer(),
    ])
    check(deps.signal)
    const pixels = job.roi.width * job.roi.height
    const rgb = new Uint8Array(pixels * 3)
    const mask = new Uint8Array(pixels)
    for (let i = 0; i < pixels; i++) {
      rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3)
      mask[i] = coverage[i] > 0 ? 255 : 0
    }
    const decodeMs = performance.now() - start
    deps.progress(1, 4)
    stage = 'inference'
    const inferenceStart = performance.now()
    let repaired: Uint8Array = rgb
    let provider: ImageInpaintResult['provider'] = 'wasm'
    if (mask.some(value => value !== 0)) {
      if (mask.every(value => value !== 0)) throw new Error('roi 需要包含未选择的周边像素，才能修补。')
      if (job.algorithm === 'telea' || job.algorithm === 'ns') {
        repaired = await classic(rgb, mask, job.roi.width, job.roi.height, job.algorithm)
      } else {
        if (!job.model || job.model.name !== job.algorithm) throw new Error('图片修补作业缺少对应的已校验模型。')
        // 等比缩放 + 右/下复制边缘；避免把长条 ROI 拉伸成方形。覆盖率仅供融合，网络吃二值洞。
        const scale = Math.min(SIZE / job.roi.width, SIZE / job.roi.height)
        const rw = Math.max(1, Math.round(job.roi.width * scale)); const rh = Math.max(1, Math.round(job.roi.height * scale))
        const resized = await sharp(rgb, { raw: { width: job.roi.width, height: job.roi.height, channels: 3 } }).resize(rw, rh).raw().toBuffer()
        const resizedMask = await sharp(mask, { raw: { width: job.roi.width, height: job.roi.height, channels: 1 } }).resize(rw, rh, { kernel: 'nearest' }).toColourspace('b-w').raw().toBuffer()
        const count = SIZE * SIZE
        const image = job.algorithm === 'migan' ? new Uint8Array(count * 3) : new Float32Array(count * 3)
        const holes = job.algorithm === 'migan' ? new Uint8Array(count) : new Float32Array(count)
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
          const index = y * SIZE + x
          const sourceIndex = Math.min(y, rh - 1) * rw + Math.min(x, rw - 1)
          const hole = resizedMask[sourceIndex] > 0
          holes[index] = job.algorithm === 'migan' ? (hole ? 0 : 255) : (hole ? 1 : 0)
          for (let c = 0; c < 3; c++) image[c * count + index] = resized[sourceIndex * 3 + c] / (job.algorithm === 'migan' ? 1 : 255)
        }
        check(deps.signal)
        const runner = await deps.openModel(job.model, job.providers, `${SIZE}x${SIZE}`)
        check(deps.signal)
        deps.progress(2, 4)
        const feeds: Record<string, LocalTensorInput> = job.algorithm === 'migan'
          ? { image: { type: 'uint8', data: image as Uint8Array, dims: [1, 3, SIZE, SIZE] }, mask: { type: 'uint8', data: holes as Uint8Array, dims: [1, 1, SIZE, SIZE] } }
          : { image: { type: 'float32', data: image as Float32Array, dims: [1, 3, SIZE, SIZE] }, mask: { type: 'float32', data: holes as Float32Array, dims: [1, 1, SIZE, SIZE] } }
        const outputs = await runner.run(feeds)
        check(deps.signal)
        const out = outputs[job.algorithm === 'migan' ? 'result' : 'output']
        if (!out || out.dims.join(',') !== `1,3,${SIZE},${SIZE}`
          || (job.algorithm === 'migan' ? !(out.data instanceof Uint8Array) : !(out.data instanceof Float32Array))) throw new Error('图片修补模型输出类型或尺寸不匹配。')
        const values = out.data as Uint8Array | Float32Array
        const interleaved = new Uint8Array(count * 3)
        for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) {
          const value = values[c * count + i] // Carve 输出已经是 0..255，而不是 0..1。
          if (!Number.isFinite(value)) throw new Error('图片修补模型输出包含无效像素。')
          interleaved[i * 3 + c] = Math.round(Math.max(0, Math.min(255, value)))
        }
        repaired = new Uint8Array(await sharp(interleaved, { raw: { width: SIZE, height: SIZE, channels: 3 } })
          .extract({ left: 0, top: 0, width: rw, height: rh }).resize(job.roi.width, job.roi.height).raw().toBuffer())
        provider = runner.provider
      }
    }
    check(deps.signal)
    const inferenceMs = performance.now() - inferenceStart
    deps.progress(3, 4)
    stage = 'output'
    const compositeStart = performance.now()
    for (let i = 0; i < pixels; i++) {
      const weight = coverage[i] / 255
      if (!weight) continue // 非选区与 alpha 保持字节不变，不用神经模型整图替换原件。
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(rgba[i * 4 + c] * (1 - weight) + repaired[i * 3 + c] * weight)
    }
    await sharp(rgba, { raw: { width: job.roi.width, height: job.roi.height, channels: 4 } }).png().toFile(job.outputPath)
    check(deps.signal)
    const result: ImageInpaintResult = { algorithm: job.algorithm, provider, roi: { ...job.roi }, outputPath: job.outputPath,
      decodeMs, inferenceMs, compositeMs: performance.now() - compositeStart, durationMs: performance.now() - start }
    deps.progress(4, 4)
    deps.log('info', '图片修补完成', 'local_inference.inpaint.completed', { ...context, ...result, outputPath: undefined })
    return result
  } catch (error) {
    const failure = error instanceof ImageInpaintError ? error : new ImageInpaintError(deps.signal.aborted ? 'cancelled' : stage, error instanceof Error ? error.message : '图片修补失败。', { cause: error })
    deps.log('warn', failure.message, 'local_inference.inpaint.failed', { ...context, code: failure.code })
    throw failure
  }
}
