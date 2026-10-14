import type { PrivacyBox } from '../../../../../src/core/screenRecording/privacy'
import type { LocalModelRunner, LocalTensorOutput } from '../analysis'

export type RecognitionNormalization = 'rgb-half' | 'bgr-unit'
export interface RecognizedText { text: string; confidence: number }
export interface PixelCrop { x: number; y: number; width: number; height: number; tensorWidth: number }
export interface RecognitionBatchPolicy { widthMultiple: number; pixelBudget: number }
// 32/64 padding was faster but dropped a narrow 'I' in the real capture regression. Keep 128's context.
export const RECOGNITION_BATCH_POLICY: RecognitionBatchPolicy = { widthMultiple: 128, pixelBudget: 3072 }
export type CropRecognizer = (rgb: Uint8Array, width: number, crops: readonly PixelCrop[], signal: AbortSignal) => Promise<RecognizedText[]>
export function recognitionCrop(width: number, height: number, box: PrivacyBox): PixelCrop {
  const x = Math.max(0, Math.min(width - 1, Math.floor(box[0] * width)))
  const y = Math.max(0, Math.min(height - 1, Math.floor(box[1] * height)))
  const w = Math.max(1, Math.min(width - x, Math.ceil(box[2] * width)))
  const h = Math.max(1, Math.min(height - y, Math.ceil(box[3] * height)))
  return { x, y, width: w, height: h, tensorWidth: Math.min(1920, Math.max(1, Math.round(48 * w / h))) }
}
export function recognitionBatches(crops: readonly PixelCrop[], policy = RECOGNITION_BATCH_POLICY): number[][] {
  const sorted = crops.map((_, i) => i).sort((a, b) => crops[a].tensorWidth - crops[b].tensorWidth)
  const batches: number[][] = []
  for (const index of sorted) {
    const last = batches.at(-1), padded = Math.ceil(crops[index].tensorWidth / policy.widthMultiple) * policy.widthMultiple
    if (!last || last.length >= 32 || (last.length + 1) * padded > policy.pixelBudget) batches.push([index])
    else last.push(index)
  }
  return batches
}
function resizeAxis(source: number, target: number): Array<{ start: number; weights: number[] }> {
  const scale = source / target, radius = Math.max(1, scale)
  return Array.from({ length: target }, (_, index) => {
    const center = (index + .5) * scale - .5
    const start = Math.max(0, Math.ceil(center - radius)), end = Math.min(source - 1, Math.floor(center + radius))
    const weights = Array.from({ length: end - start + 1 }, (_, i) => Math.max(0, 1 - Math.abs(start + i - center) / radius))
    const sum = weights.reduce((a, b) => a + b, 0)
    return { start, weights: weights.map(w => w / sum) }
  })
}
/** Scale-aware separable bilinear filter: downsampling must integrate thin strokes, not point-sample them away. */
function resizeCropIntoBatch(rgb: Uint8Array, sourceWidth: number, crop: PixelCrop, data: Float32Array, offset: number, width: number, normalization: RecognitionNormalization): void {
  const xs = resizeAxis(crop.width, crop.tensorWidth), ys = resizeAxis(crop.height, 48), stride = crop.tensorWidth * 3
  const horizontal = new Float32Array(crop.height * stride)
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.tensorWidth; x++) {
    const axis = xs[x], source = ((crop.y + y) * sourceWidth + crop.x + axis.start) * 3, target = y * stride + x * 3
    let red = 0, green = 0, blue = 0
    for (let tap = 0; tap < axis.weights.length; tap++) {
      const offset = source + tap * 3, weight = axis.weights[tap]
      red += rgb[offset] * weight; green += rgb[offset + 1] * weight; blue += rgb[offset + 2] * weight
    }
    horizontal[target] = red; horizontal[target + 1] = green; horizontal[target + 2] = blue
  }
  const plane = width * 48, first = normalization === 'rgb-half' ? 0 : 2, last = 2 - first
  const divisor = normalization === 'rgb-half' ? 255 : 127.5, bias = normalization === 'rgb-half' ? 0.5 : 1
  for (let y = 0; y < 48; y++) {
    const axis = ys[y]
    for (let x = 0; x < crop.tensorWidth; x++) {
      let red = 0, green = 0, blue = 0
      for (let tap = 0; tap < axis.weights.length; tap++) {
        const source = (axis.start + tap) * stride + x * 3, weight = axis.weights[tap]
        red += horizontal[source] * weight; green += horizontal[source + 1] * weight; blue += horizontal[source + 2] * weight
      }
      const target = offset + y * width + x
      data[target + first * plane] = Math.round(red) / divisor - bias
      data[target + plane] = Math.round(green) / divisor - bias
      data[target + last * plane] = Math.round(blue) / divisor - bias
    }
  }
}
/** Resample directly from the original RGB frame into a batched tensor; no per-line Sharp decode/copy. */
export function recognitionBatchInput(rgb: Uint8Array, sourceWidth: number, crops: readonly PixelCrop[], normalization: RecognitionNormalization = 'rgb-half', policy = RECOGNITION_BATCH_POLICY): { data: Float32Array; width: number } {
  const width = Math.ceil(Math.max(...crops.map(c => c.tensorWidth)) / policy.widthMultiple) * policy.widthMultiple
  const plane = width * 48, data = new Float32Array(crops.length * 3 * plane).fill(normalization === 'rgb-half' ? 0.5 : 1)
  for (let n = 0; n < crops.length; n++) {
    resizeCropIntoBatch(rgb, sourceWidth, crops[n], data, n * 3 * plane, width, normalization)
  }
  return { data, width }
}
export function readRecognitionDictionary(text: string): string[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  while (lines.at(-1) === '') lines.pop()
  if (!lines.length || lines.some(line => !line)) throw new Error('文字识别字典为空或含无效条目。')
  return lines
}
/** PP-OCR CTC classes are blank + dictionary + space, independently for every batch row. */
export function decodeRecognitionBatch(output: LocalTensorOutput, alphabet: readonly string[]): RecognizedText[] {
  const chars = ['', ...alphabet, ' '], [batch, steps, classes] = output.dims
  if (!(output.data instanceof Float32Array) || output.dims.length !== 3 || !Number.isInteger(batch) || batch < 1 || !Number.isInteger(steps) || steps < 1 || classes !== chars.length || output.data.length !== batch * steps * classes) throw new Error('文字识别模型输出与字典不匹配。')
  const results: RecognizedText[] = []
  for (let n = 0; n < batch; n++) {
    let text = '', sum = 0, count = 0, previous = -1
    for (let t = 0; t < steps; t++) {
      let selected = 0, score = -Infinity
      const offset = (n * steps + t) * classes
      for (let c = 0; c < classes; c++) if (output.data[offset + c] > score) { score = output.data[offset + c]; selected = c }
      if (!Number.isFinite(score)) throw new Error('文字识别模型输出无效。')
      if (selected && selected !== previous) { text += chars[selected]; sum += Math.min(1, Math.max(0, score)); count++ }
      previous = selected
    }
    results.push({ text, confidence: count ? sum / count : 0 })
  }
  return results
}
export async function recognizeCrops(rgb: Uint8Array, width: number, crops: readonly PixelCrop[], runner: LocalModelRunner, alphabet: readonly string[], signal: AbortSignal, normalization: RecognitionNormalization = 'rgb-half', policy = RECOGNITION_BATCH_POLICY): Promise<RecognizedText[]> {
  const results: RecognizedText[] = new Array(crops.length)
  for (const batch of recognitionBatches(crops, policy)) {
    signal.throwIfAborted()
    const input = recognitionBatchInput(rgb, width, batch.map(i => crops[i]), normalization, policy)
    const output = Object.values(await runner.run({ x: { type: 'float32', data: input.data, dims: [batch.length, 3, 48, input.width] } }))[0]
    if (!output) throw new Error('文字识别模型没有输出。')
    const decoded = decodeRecognitionBatch(output, alphabet)
    if (decoded.length !== batch.length) throw new Error('文字识别批大小不匹配。')
    batch.forEach((index, n) => { results[index] = decoded[n] })
  }
  signal.throwIfAborted()
  return results
}
