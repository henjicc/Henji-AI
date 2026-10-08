import { loadTrackingOpenCv } from '../tracking/openCvTracking'

/** 当前 OpenCV.js 没有 seamlessClone；复用其精确距离变换，向选区内部羽化并保留来源纹理。 */
export async function blendSampleTexture(rgb: Uint8Array, sample: Uint8Array, mask: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  if (sample.length !== width * height * 4) throw new Error('来源区域尺寸不匹配')
  const { cv } = await loadTrackingOpenCv()
  // 外围零边界让碰到图像边缘的选区也拥有有定义的内部距离。
  const bordered = new Uint8Array((width + 2) * (height + 2))
  for (let y = 0; y < height; y++) bordered.set(mask.subarray(y * width, (y + 1) * width), (y + 1) * (width + 2) + 1)
  const input = cv.matFromArray(height + 2, width + 2, cv.CV_8UC1, bordered), distance = new cv.Mat()
  try {
    cv.distanceTransform(input, distance, cv.DIST_L2, cv.DIST_MASK_PRECISE)
    const output = new Uint8Array(rgb)
    const radius = Math.max(1, Math.min(width, height) * 0.02)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!mask[i]) continue
      if (sample[i * 4 + 3] === 0) throw new Error('来源区域含透明像素，请选择有纹理的干净区域')
      const d = Math.min(1, distance.data32F[(y + 1) * (width + 2) + x + 1] / radius)
      const weight = d * d * (3 - 2 * d)
      for (let c = 0; c < 3; c++) output[i * 3 + c] = Math.round(rgb[i * 3 + c] * (1 - weight) + sample[i * 4 + c] * weight)
    }
    return output
  } finally { input.delete(); distance.delete() }
}
