import { mosaicInputRegion, type MosaicPlan, type MosaicRegion } from '../mosaic'

/** 每个色块只求和一次；预乘 Alpha 与 RGB 一起平均，避免透明边缘漏色。 */
export function executeMosaicCpu(plan: MosaicPlan, input: MosaicRegion & { data: Float32Array }, output: MosaicRegion): Float32Array {
  const required = mosaicInputRegion(plan, output)
  if (input.data.length !== input.width * input.height * 4 || required.x < input.x || required.y < input.y
    || required.x + required.width > input.x + input.width || required.y + required.height > input.y + input.height) throw new Error('马赛克输入缺少完整色块像素')
  const data = new Float32Array(output.width * output.height * 4)
  for (let by = required.y; by < required.y + required.height; by += plan.blockSize) {
    for (let bx = required.x; bx < required.x + required.width; bx += plan.blockSize) {
      const right = Math.min(plan.width, bx + plan.blockSize), bottom = Math.min(plan.height, by + plan.blockSize)
      const sums = [0, 0, 0, 0]
      for (let y = by; y < bottom; y++) for (let x = bx; x < right; x++) {
        const index = ((y - input.y) * input.width + x - input.x) * 4
        for (let c = 0; c < 4; c++) sums[c] += input.data[index + c]
      }
      const count = (right - bx) * (bottom - by)
      for (let c = 0; c < 4; c++) sums[c] /= count
      for (let y = Math.max(by, output.y); y < Math.min(bottom, output.y + output.height); y++) {
        for (let x = Math.max(bx, output.x); x < Math.min(right, output.x + output.width); x++) {
          const index = ((y - output.y) * output.width + x - output.x) * 4
          for (let c = 0; c < 4; c++) data[index + c] = sums[c]
        }
      }
    }
  }
  return data
}
