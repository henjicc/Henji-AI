/**
 * 通用分辨率计算工具
 *
 * 核心概念：
 * - 基数（baseSize）：控制正方形（1:1）时的边长
 * - 其他比例的分辨率根据基数计算，确保总像素数不超过 baseSize × baseSize
 */

export interface ResolutionSize {
  width: number
  height: number
}

/**
 * 根据基数和宽高比计算分辨率
 *
 * @param baseSize - 基数（正方形时的边长）
 * @param widthRatio - 宽度比例
 * @param heightRatio - 高度比例
 * @returns 计算后的宽度和高度
 *
 * @example
 * calculateResolution(1440, 16, 9) // { width: 1920, height: 1080 }
 * calculateResolution(1024, 1, 1)  // { width: 1024, height: 1024 }
 */
export function calculateResolution(
  baseSize: number,
  widthRatio: number,
  heightRatio: number
): ResolutionSize {
  // 正方形：直接使用基数
  if (widthRatio === heightRatio) {
    return { width: baseSize, height: baseSize }
  }

  // 计算最大像素数
  const maxPixels = baseSize * baseSize

  // 计算宽高比
  const ratio = widthRatio / heightRatio

  // 根据宽高比和最大像素数计算尺寸
  const height = Math.sqrt(maxPixels / ratio)
  const width = height * ratio

  // 取整到8的倍数（便于视频编码）
  const finalWidth = Math.floor(width / 8) * 8
  const finalHeight = Math.floor(height / 8) * 8

  return { width: finalWidth, height: finalHeight }
}

/**
 * 批量计算多个宽高比的分辨率
 *
 * @param baseSize - 基数
 * @param aspectRatios - 宽高比列表，格式如 ['16:9', '4:3', '1:1']
 * @returns 宽高比到分辨率的映射
 *
 * @example
 * calculateResolutions(1440, ['16:9', '4:3', '1:1'])
 * // { '16:9': { width: 1920, height: 1080 }, '4:3': { width: 1664, height: 1248 }, '1:1': { width: 1440, height: 1440 } }
 */
export function calculateResolutions(
  baseSize: number,
  aspectRatios: string[]
): Record<string, ResolutionSize> {
  const result: Record<string, ResolutionSize> = {}

  for (const ratio of aspectRatios) {
    const [w, h] = ratio.split(':').map(Number)
    if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
      console.warn(`Invalid aspect ratio: ${ratio}`)
      continue
    }
    result[ratio] = calculateResolution(baseSize, w, h)
  }

  return result
}

/**
 * 验证基数是否有效
 *
 * @param baseSize - 基数
 * @param min - 最小值
 * @param max - 最大值
 * @param step - 步进值（必须是此值的倍数）
 * @returns 是否有效
 */
export function validateBaseSize(
  baseSize: number,
  min: number = 512,
  max: number = 2048,
  step: number = 8
): boolean {
  if (baseSize < min || baseSize > max) {
    return false
  }
  if (baseSize % step !== 0) {
    return false
  }
  return true
}

/**
 * 标准化基数（调整到最接近的有效值）
 *
 * @param baseSize - 输入的基数
 * @param min - 最小值
 * @param max - 最大值
 * @param step - 步进值
 * @returns 标准化后的基数
 *
 * @example
 * normalizeBaseSize(1450, 512, 2048, 8) // 1448
 * normalizeBaseSize(500, 512, 2048, 8)  // 512
 */
export function normalizeBaseSize(
  baseSize: number,
  min: number = 512,
  max: number = 2048,
  step: number = 8
): number {
  // 限制在范围内
  let normalized = Math.max(min, Math.min(max, baseSize))

  // 调整到最接近的步进值
  normalized = Math.round(normalized / step) * step

  return normalized
}

/**
 * 常用的宽高比列表
 */
export const COMMON_ASPECT_RATIOS = [
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '1:1',
  '3:4',
  '2:3',
  '9:16',
  '9:21'
] as const

/**
 * 预设的基数配置
 */
export const PRESET_BASE_SIZES = {
  small: 512,
  medium: 1024,
  large: 1440,
  xlarge: 2048
} as const

/**
 * 根据基数和宽高比计算分辨率，并确保结果在边界范围内
 *
 * @param baseSize - 基数（正方形时的边长）
 * @param widthRatio - 宽度比例
 * @param heightRatio - 高度比例
 * @param minSize - 最小边长（默认 64）
 * @param maxSize - 最大边长（默认 2048）
 * @returns 计算后的宽度和高度
 *
 * @example
 * calculateResolutionWithBounds(1440, 16, 9, 64, 2048) // { width: 2048, height: 1152 }
 */
export function calculateResolutionWithBounds(
  baseSize: number,
  widthRatio: number,
  heightRatio: number,
  minSize: number = 64,
  maxSize: number = 2048
): ResolutionSize {
  // 先使用标准方法计算
  let { width, height } = calculateResolution(baseSize, widthRatio, heightRatio)

  // 检查是否超出边界
  const maxDimension = Math.max(width, height)
  const minDimension = Math.min(width, height)

  // 如果最大边超出限制，按比例缩小
  if (maxDimension > maxSize) {
    const scale = maxSize / maxDimension
    width = Math.floor((width * scale) / 16) * 16
    height = Math.floor((height * scale) / 16) * 16
  }

  // 如果最小边小于限制，按比例放大
  if (minDimension < minSize) {
    const scale = minSize / minDimension
    width = Math.floor((width * scale) / 16) * 16
    height = Math.floor((height * scale) / 16) * 16
  }

  // 最终确保在范围内
  width = Math.max(minSize, Math.min(maxSize, width))
  height = Math.max(minSize, Math.min(maxSize, height))

  // 确保是 16 的倍数
  width = Math.floor(width / 16) * 16
  height = Math.floor(height / 16) * 16

  return { width, height }
}
