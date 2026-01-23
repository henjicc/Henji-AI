/**
 * 图像处理工具函数
 * 职责：提供图像处理算法
 */

/**
 * 调整图像亮度
 */
export function adjustBrightness(imageData: ImageData, brightness: number): ImageData {
  const data = imageData.data
  const factor = brightness / 100

  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, data[i] * factor)     // R
    data[i + 1] = Math.min(255, data[i + 1] * factor) // G
    data[i + 2] = Math.min(255, data[i + 2] * factor) // B
  }

  return imageData
}

/**
 * 调整图像对比度
 */
export function adjustContrast(imageData: ImageData, contrast: number): ImageData {
  const data = imageData.data
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))

  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128))
    data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128))
    data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128))
  }

  return imageData
}

/**
 * 调整图像饱和度
 */
export function adjustSaturation(imageData: ImageData, saturation: number): ImageData {
  const data = imageData.data
  const factor = saturation / 100

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b

    data[i] = Math.min(255, Math.max(0, gray + factor * (r - gray)))
    data[i + 1] = Math.min(255, Math.max(0, gray + factor * (g - gray)))
    data[i + 2] = Math.min(255, Math.max(0, gray + factor * (b - gray)))
  }

  return imageData
}
