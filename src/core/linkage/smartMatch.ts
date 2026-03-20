import { createLogger } from '@/core/logging'

const logger = createLogger('core.linkage.smartMatch')

/**
 * 智能匹配算法
 *
 * 提供图片比例匹配、最近值查找等智能匹配功能
 */

/**
 * 查找最接近的比例
 *
 * @param targetRatio - 目标比例（数值，如 1.77）
 * @param ratios - 可用比例数组（字符串，如 ['16:9', '9:16', '1:1']）
 * @returns 最接近的比例字符串
 *
 * @example
 * ```typescript
 * const ratio = findClosestRatio(1.77, ['16:9', '9:16', '1:1'])
 * // '16:9' (1.777... 最接近 1.77)
 * ```
 */
export function findClosestRatio(targetRatio: number, ratios: string[]): string {
  if (ratios.length === 0) {
    throw new Error('Ratios array cannot be empty')
  }

  let closestRatio = ratios[0]
  let minDiff = Infinity

  for (const ratio of ratios) {
    const [w, h] = ratio.split(':').map(Number)

    if (isNaN(w) || isNaN(h) || h === 0) {
      logger.warn(`[SmartMatch] Invalid ratio format: ${ratio}`)
      continue
    }

    const r = w / h
    const diff = Math.abs(r - targetRatio)

    if (diff < minDiff) {
      minDiff = diff
      closestRatio = ratio
    }
  }

  return closestRatio
}

/**
 * 从图片尺寸查找最接近的比例
 *
 * @param imageSize - 图片尺寸 { width, height }
 * @param ratios - 可用比例数组
 * @returns 最接近的比例字符串
 *
 * @example
 * ```typescript
 * const ratio = findClosestAspectRatio(
 *   { width: 1920, height: 1080 },
 *   ['16:9', '4:3', '1:1']
 * )
 * // '16:9'
 * ```
 */
export function findClosestAspectRatio(
  imageSize: { width: number; height: number },

  ratios: string[]
): string {
  if (imageSize.height === 0) {
    throw new Error('Image height cannot be zero')
  }

  const targetRatio = imageSize.width / imageSize.height
  return findClosestRatio(targetRatio, ratios)
}

/**
 * 从 Base64 图片数据获取尺寸
 *
 * @param dataUrl - Base64 图片数据
 * @returns Promise<{ width, height }>
 *
 * @example
 * ```typescript
 * const size = await getImageSize('data:image/png;base64,...')
 * // { width: 1920, height: 1080 }
 * ```
 */
export async function getImageSize(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()

    img.onload = () => {
      resolve({
        width: img.width,
        height: img.height
      })
    }

    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }

    img.src = dataUrl
  })
}

/**
 * 智能匹配图片比例
 *
 * 从 Base64 图片数据中提取尺寸，并匹配最接近的比例
 *
 * @param imageDataUrl - Base64 图片数据
 * @param availableRatios - 可用比例数组
 * @returns Promise<最接近的比例字符串>
 *
 * @example
 * ```typescript
 * const ratio = await smartMatchImageRatio(
 *   'data:image/png;base64,...',
 *   ['16:9', '9:16', '1:1', '4:3']
 * )
 * // '16:9'
 * ```
 */
export async function smartMatchImageRatio(
  imageDataUrl: string,
  availableRatios: string[]
): Promise<string> {
  try {
    const size = await getImageSize(imageDataUrl)
    return findClosestAspectRatio(size, availableRatios)
  } catch (error) {
    logger.error('[SmartMatch] Failed to match image ratio:', error)
    // 返回第一个可用比例作为降级
    return availableRatios[0] || '16:9'
  }
}

/**
 * 查找最接近的数值
 *
 * @param target - 目标数值
 * @param values - 可用数值数组
 * @returns 最接近的数值
 *
 * @example
 * ```typescript
 * const value = findClosestValue(7, [5, 10, 15])
 * // 5
 * ```
 */
export function findClosestValue(target: number, values: number[]): number {
  if (values.length === 0) {
    throw new Error('Values array cannot be empty')
  }

  let closestValue = values[0]
  let minDiff = Infinity

  for (const value of values) {
    const diff = Math.abs(value - target)

    if (diff < minDiff) {
      minDiff = diff
      closestValue = value
    }
  }

  return closestValue
}

/**
 * 比例字符串转数值
 *
 * @param ratio - 比例字符串（如 '16:9'）
 * @returns 比例数值（如 1.777...）
 *
 * @example
 * ```typescript
 * const value = ratioToNumber('16:9')
 * // 1.7777777777777777
 * ```
 */
export function ratioToNumber(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number)

  if (isNaN(w) || isNaN(h) || h === 0) {
    throw new Error(`Invalid ratio format: ${ratio}`)
  }

  return w / h
}

/**
 * 数值转最接近的比例字符串
 *
 * @param value - 比例数值
 * @param availableRatios - 可用比例数组
 * @returns 最接近的比例字符串
 */
export function numberToRatio(value: number, availableRatios: string[]): string {
  return findClosestRatio(value, availableRatios)
}
