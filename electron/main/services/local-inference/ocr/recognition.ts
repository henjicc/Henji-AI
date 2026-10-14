import type { PrivacyBox } from '../../../../../src/core/screenRecording/privacy'
import type { LocalModelRunner, LocalTensorOutput } from '../analysis'

export type RecognitionNormalization = 'rgb-half' | 'bgr-unit'
export interface RecognizedText { text: string; confidence: number }
export interface PixelCrop { x: number; y: number; width: number; height: number; tensorWidth: number }
export function recognitionCrop(width: number, height: number, box: PrivacyBox): PixelCrop {
  const x = Math.max(0, Math.min(width - 1, Math.floor(box[0] * width)))
  const y = Math.max(0, Math.min(height - 1, Math.floor(box[1] * height)))
  const w = Math.max(1, Math.min(width - x, Math.ceil(box[2] * width)))
  const h = Math.max(1, Math.min(height - y, Math.ceil(box[3] * height)))
  return { x, y, width: w, height: h, tensorWidth: Math.min(1920, Math.max(1, Math.round(48 * w / h))) }
}
export function recognitionBatches(crops: readonly PixelCrop[]): number[][] {
  const sorted = crops.map((_, i) => i).sort((a, b) => crops[a].tensorWidth - crops[b].tensorWidth)
  const batches: number[][] = []
  for (const index of sorted) {
    const last = batches.at(-1), padded = Math.ceil(crops[index].tensorWidth / 128) * 128
    if (!last || last.length >= 32 || (last.length + 1) * padded > 4096) batches.push([index])
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
function resizeCrop(rgb: Uint8Array, sourceWidth: number, crop: PixelCrop): Float32Array {
  const xs = resizeAxis(crop.width, crop.tensorWidth), ys = resizeAxis(crop.height, 48), stride = crop.tensorWidth * 3
  const horizontal = new Float32Array(crop.height * stride), result = new Float32Array(48 * stride)
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.tensorWidth; x++) {
    const axis = xs[x], source = ((crop.y + y) * sourceWidth + crop.x + axis.start) * 3, target = y * stride + x * 3
    for (let tap = 0; tap < axis.weights.length; tap++) for (let c = 0; c < 3; c++) horizontal[target + c] += rgb[source + tap * 3 + c] * axis.weights[tap]
  }
  for (let y = 0; y < 48; y++) {
    const axis = ys[y]
    for (let x = 0; x < stride; x++) {
      let value = 0
      for (let tap = 0; tap < axis.weights.length; tap++) value += horizontal[(axis.start + tap) * stride + x] * axis.weights[tap]
      result[y * stride + x] = Math.round(value)
    }
  }
  return result
}
/** Resample directly from the original RGB frame into a batched tensor; no per-line Sharp decode/copy. */
export function recognitionBatchInput(rgb: Uint8Array, sourceWidth: number, crops: readonly PixelCrop[], normalization: RecognitionNormalization = 'rgb-half'): { data: Float32Array; width: number } {
  const width = Math.ceil(Math.max(...crops.map(c => c.tensorWidth)) / 128) * 128
  const plane = width * 48, data = new Float32Array(crops.length * 3 * plane).fill(normalization === 'rgb-half' ? 0.5 : 1)
  for (let n = 0; n < crops.length; n++) {
    const crop = crops[n], resized = resizeCrop(rgb, sourceWidth, crop)
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < crop.tensorWidth; x++) {
        for (let c = 0; c < 3; c++) {
          const channel = normalization === 'rgb-half' ? c : 2 - c
          const value = resized[(y * crop.tensorWidth + x) * 3 + channel]
          data[n * 3 * plane + c * plane + y * width + x] = normalization === 'rgb-half' ? value / 255 - 0.5 : value / 127.5 - 1
        }
      }
    }
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
export async function recognizeCrops(rgb: Uint8Array, width: number, crops: readonly PixelCrop[], runner: LocalModelRunner, alphabet: readonly string[], signal: AbortSignal, normalization: RecognitionNormalization = 'rgb-half'): Promise<RecognizedText[]> {
  const results: RecognizedText[] = new Array(crops.length)
  for (const batch of recognitionBatches(crops)) {
    signal.throwIfAborted()
    const input = recognitionBatchInput(rgb, width, batch.map(i => crops[i]), normalization)
    const output = Object.values(await runner.run({ x: { type: 'float32', data: input.data, dims: [batch.length, 3, 48, input.width] } }))[0]
    if (!output) throw new Error('文字识别模型没有输出。')
    const decoded = decodeRecognitionBatch(output, alphabet)
    if (decoded.length !== batch.length) throw new Error('文字识别批大小不匹配。')
    batch.forEach((index, n) => { results[index] = decoded[n] })
  }
  signal.throwIfAborted()
  return results
}
