import { float16ToUnorm8Table, unorm8ToFloat16Table } from '../fp16'

/*
 * 人物抠像。
 * - Robust Video Matting（MobileNetV3，fp16）：输入 RGB 0–1 半精度平面，带 4 个时间递归状态（上一帧的输出接到下一帧的输入，
 *   边缘因此随时间稳定）；输出 pha 即人物不透明度。按 2026-10-06 实测（任务文件 4.7d）长边 512、downsample_ratio 0.5。
 * - MediaPipe Selfie Segmentation：输入 256×256 RGB 0–1（拉伸），输出 alphas；没有时间状态，作为 RVM 不可用时的后备。
 */

export const RVM_LONG_SIDE = 512
export const RVM_DOWNSAMPLE_RATIO = 0.5
export const SELFIE_INPUT_SIZE = 256

/** RVM 输入尺寸：保持比例，长边 512，两边都取 16 的倍数（网络内部多次减半）。 */
export function rvmInputSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const scale = RVM_LONG_SIDE / Math.max(1, sourceWidth, sourceHeight)
  const align = (value: number): number => Math.max(16, Math.round(value * scale / 16) * 16)
  return { width: align(sourceWidth), height: align(sourceHeight) }
}

/** RGB24 → RVM 的半精度平面输入（查表换算 value/255）。 */
export function rvmSourceTensor(rgb: Uint8Array, width: number, height: number, target = new Uint16Array(3 * width * height)): Uint16Array {
  const table = unorm8ToFloat16Table(); const plane = width * height
  for (let index = 0; index < plane; index++) {
    target[index] = table[rgb[index * 3]]; target[plane + index] = table[rgb[index * 3 + 1]]; target[2 * plane + index] = table[rgb[index * 3 + 2]]
  }
  return target
}

/** RVM 的半精度 pha → 单字节蒙版。 */
export function rvmMatte(pha: Uint16Array): Uint8Array {
  const table = float16ToUnorm8Table(); const output = new Uint8Array(pha.length)
  for (let index = 0; index < pha.length; index++) output[index] = table[pha[index]]
  return output
}

/** RGB24（已由解码进程缩放为 256×256）→ Selfie 的 RGB 0–1 平面输入。 */
export function selfieInput(rgb: Uint8Array, target = new Float32Array(3 * SELFIE_INPUT_SIZE * SELFIE_INPUT_SIZE)): Float32Array {
  const plane = SELFIE_INPUT_SIZE * SELFIE_INPUT_SIZE
  for (let index = 0; index < plane; index++) {
    target[index] = rgb[index * 3] / 255; target[plane + index] = rgb[index * 3 + 1] / 255; target[2 * plane + index] = rgb[index * 3 + 2] / 255
  }
  return target
}

/** Selfie 的 256×256 alphas → 按显示比例重采样（双线性）的单字节蒙版。 */
export function selfieMatte(alphas: Float32Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height)
  const size = SELFIE_INPUT_SIZE
  const at = (x: number, y: number): number => alphas[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))]
  for (let y = 0; y < height; y++) {
    const sy = (y + 0.5) * size / height - 0.5; const y0 = Math.floor(sy); const fy = sy - y0
    for (let x = 0; x < width; x++) {
      const sx = (x + 0.5) * size / width - 0.5; const x0 = Math.floor(sx); const fx = sx - x0
      const value = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
      output[y * width + x] = Math.max(0, Math.min(255, Math.round(value * 255)))
    }
  }
  return output
}

/** 蒙版中人物面积占比（0–1），用于摘要。 */
export function matteCoverage(matte: Uint8Array): number {
  let sum = 0
  for (let index = 0; index < matte.length; index++) sum += matte[index]
  return matte.length ? sum / matte.length / 255 : 0
}
