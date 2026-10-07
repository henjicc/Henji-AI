import { trackingFrameBatchCount } from '@/platform/contracts/tracking'

/** 在正式渲染 Worker 内缩放、读回及合到黑底，避免 RGB 转换阻塞界面线程。 */
export function readVideoEditTrackingRgb(picture: OffscreenCanvas, size: { width: number; height: number }): Uint8Array {
  trackingFrameBatchCount(size.width, size.height)
  const canvas = new OffscreenCanvas(size.width, size.height)
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法读取嵌套序列画面。')
    context.drawImage(picture, 0, 0, size.width, size.height)
    const rgba = context.getImageData(0, 0, size.width, size.height).data
    const rgb = new Uint8Array(size.width * size.height * 3)
    for (let pixel = 0, out = 0; pixel < rgba.length; pixel += 4) for (let channel = 0; channel < 3; channel++) rgb[out++] = Math.round(rgba[pixel + channel] * rgba[pixel + 3] / 255)
    return rgb
  } finally { canvas.width = 1; canvas.height = 1 }
}
