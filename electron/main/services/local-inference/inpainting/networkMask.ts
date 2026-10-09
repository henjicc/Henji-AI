import { loadTrackingOpenCv } from '../tracking/openCvTracking'

/** 只外扩送给模型的洞，不外扩最终提交覆盖率。阻止洞边缘颜色重新渗进预测。 */
export async function expandInpaintNetworkMask(mask: Uint8Array, width: number, height: number, radius = 3): Promise<Uint8Array> {
  if (mask.length !== width * height || !Number.isInteger(radius) || radius < 0) throw new Error('推理遮罩参数无效')
  if (!radius) return new Uint8Array(mask)
  const { cv } = await loadTrackingOpenCv(), input = cv.matFromArray(height, width, cv.CV_8UC1, mask), output = new cv.Mat()
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(radius * 2 + 1, radius * 2 + 1))
  try {
    cv.dilate(input, output, kernel)
    const expanded = new Uint8Array(output.data)
    // 极窄边界不能吞掉最后的已知背景，否则网络失去修补依据。
    return expanded.every(value => value > 0) && mask.some(value => value === 0) ? new Uint8Array(mask) : expanded
  }
  finally { kernel.delete(); output.delete(); input.delete() }
}
