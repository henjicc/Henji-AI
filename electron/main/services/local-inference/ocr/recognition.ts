import type { PrivacyBox } from '../../../../../src/core/screenRecording/privacy'
import type { LocalTensorOutput } from '../analysis'
import sharp from 'sharp'

/** RapidOCR/PaddleOCR RecResizeImg: BGR, height 48, ratio-preserving resize, right zero padding. */
export async function recognitionInput(rgb: Uint8Array, width: number, height: number, box: PrivacyBox): Promise<{ data: Float32Array; width: number }> {
  const x = Math.floor(box[0] * width), y = Math.floor(box[1] * height)
  const w = Math.max(1, Math.min(width - x, Math.ceil(box[2] * width))), h = Math.max(1, Math.min(height - y, Math.ceil(box[3] * height)))
  const resized = Math.min(2048, Math.max(1, Math.ceil(48 * w / h)))
  const targetWidth = Math.max(320, Math.ceil(resized / 32) * 32), plane = targetWidth * 48, data = new Float32Array(plane * 3)
  const crop = await sharp(rgb, { raw: { width, height, channels: 3 } }).extract({ left: x, top: y, width: w, height: h }).resize(resized, 48, { fit: 'fill', kernel: 'linear' }).raw().toBuffer()
  for (let ty = 0; ty < 48; ty++) for (let tx = 0; tx < resized; tx++) {
    const src = (ty * resized + tx) * 3, dst = ty * targetWidth + tx
    for (let c = 0; c < 3; c++) data[c * plane + dst] = crop[src + 2 - c] / 127.5 - 1
  }
  return { data, width: targetWidth }
}
/** CTC collapse repeats and blank; the ONNX embedded alphabet omits blank and trailing space. */
export function decodeRecognition(output: LocalTensorOutput, alphabet: readonly string[]): { text: string; confidence: number } {
  const chars = ['', ...alphabet, ' '], [batch, steps, classes] = output.dims
  if (!(output.data instanceof Float32Array) || batch !== 1 || classes !== chars.length || output.data.length !== steps * classes) throw new Error('文字识别模型输出与内置字典不匹配。')
  let text = '', sum = 0, count = 0, previous = -1
  for (let t = 0; t < steps; t++) {
    let selected = 0, score = -Infinity
    for (let c = 0; c < classes; c++) if (output.data[t * classes + c] > score) { score = output.data[t * classes + c]; selected = c }
    if (!Number.isFinite(score)) throw new Error('文字识别模型输出无效。')
    if (selected && selected !== previous) { text += chars[selected]; sum += Math.min(1, Math.max(0, score)); count++ }
    previous = selected
  }
  return { text, confidence: count ? sum / count : 0 }
}
