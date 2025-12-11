/**
 * Qwen-Image-Edit-2509 专用分辨率计算工具
 *
 * 特点：
 * - 不使用基数系统
 * - 每个比例自动计算符合 [64, 2048] 范围的最佳值
 * - 优先使用较大的分辨率以获得更好的图像质量
 */

import { logWarning } from '../utils/errorLogger'
export interface ResolutionSize {
  width: number
  height: number
}

/**
 * 为 Qwen-Image-Edit-2509 计算最佳分辨率
 *
 * 策略：
 * 1. 确保宽高都在 [64, 2048] 范围内
 * 2. 优先使用较大的分辨率（接近 2048）
 * 3. 取整到 8 的倍数
 *
 * @param widthRatio - 宽度比例
 * @param heightRatio - 高度比例
 * @returns 计算后的宽度和高度
 */
export function calculateQwenResolution(
  widthRatio: number,
  heightRatio: number
): ResolutionSize {
  const MIN_SIZE = 64
  const MAX_SIZE = 2048
  const STEP = 8

  // 正方形：直接使用最大值
  if (widthRatio === heightRatio) {
    return { width: MAX_SIZE, height: MAX_SIZE }
  }

  // 计算宽高比
  const ratio = widthRatio / heightRatio

  let width: number
  let height: number

  if (ratio > 1) {
    // 横向图片：宽度优先使用最大值
    width = MAX_SIZE
    height = width / ratio

    // 如果高度小于最小值，调整宽度
    if (height < MIN_SIZE) {
      height = MIN_SIZE
      width = height * ratio
    }
  } else {
    // 纵向图片：高度优先使用最大值
    height = MAX_SIZE
    width = height * ratio

    // 如果宽度小于最小值，调整高度
    if (width < MIN_SIZE) {
      width = MIN_SIZE
      height = width / ratio
    }
  }

  // 取整到 8 的倍数
  const finalWidth = Math.floor(width / STEP) * STEP
  const finalHeight = Math.floor(height / STEP) * STEP

  // 确保在范围内
  return {
    width: Math.max(MIN_SIZE, Math.min(MAX_SIZE, finalWidth)),
    height: Math.max(MIN_SIZE, Math.min(MAX_SIZE, finalHeight))
  }
}

/**
 * 批量计算多个宽高比的分辨率
 */
export function calculateQwenResolutions(
  aspectRatios: string[]
): Record<string, ResolutionSize> {
  const result: Record<string, ResolutionSize> = {}

  for (const ratio of aspectRatios) {
    const [w, h] = ratio.split(':').map(Number)
    if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
      logWarning('', `Invalid aspect ratio: ${ratio}`)
      continue
    }
    result[ratio] = calculateQwenResolution(w, h)
  }

  return result
}

/**
 * 根据图片尺寸智能计算分辨率（保持原图比例）
 *
 * 策略：
 * 1. 尽可能保持原图的实际宽高比
 * 2. 确保宽高都在 [64, 2048] 范围内
 * 3. 取整到 8 的倍数
 * 4. 优先使用较大的分辨率以获得更好的图像质量
 *
 * @param imageWidth - 图片宽度
 * @param imageHeight - 图片高度
 * @returns 计算后的分辨率
 */
export function smartMatchQwenResolution(
  imageWidth: number,
  imageHeight: number
): ResolutionSize {
  const MIN_SIZE = 64
  const MAX_SIZE = 2048
  const STEP = 8

  // 计算原图宽高比
  const ratio = imageWidth / imageHeight

  let width: number
  let height: number

  // 正方形或接近正方形
  if (Math.abs(ratio - 1) < 0.01) {
    return { width: MAX_SIZE, height: MAX_SIZE }
  }

  if (ratio > 1) {
    // 横向图片：宽度优先使用最大值
    width = MAX_SIZE
    height = width / ratio

    // 如果高度小于最小值，调整宽度
    if (height < MIN_SIZE) {
      height = MIN_SIZE
      width = height * ratio
    }
  } else {
    // 纵向图片：高度优先使用最大值
    height = MAX_SIZE
    width = height * ratio

    // 如果宽度小于最小值，调整高度
    if (width < MIN_SIZE) {
      width = MIN_SIZE
      height = width / ratio
    }
  }

  // 取整到 8 的倍数
  const finalWidth = Math.floor(width / STEP) * STEP
  const finalHeight = Math.floor(height / STEP) * STEP

  // 确保在范围内
  return {
    width: Math.max(MIN_SIZE, Math.min(MAX_SIZE, finalWidth)),
    height: Math.max(MIN_SIZE, Math.min(MAX_SIZE, finalHeight))
  }
}

/**
 * 根据图片尺寸匹配最接近的预设宽高比
 * （用于 UI 显示，不影响实际计算）
 *
 * @param imageWidth - 图片宽度
 * @param imageHeight - 图片高度
 * @param availableRatios - 可用的宽高比列表
 * @returns 最接近的宽高比
 */
export function findClosestAspectRatio(
  imageWidth: number,
  imageHeight: number,
  availableRatios: string[]
): string {
  const imageRatio = imageWidth / imageHeight

  let closestRatio = availableRatios[0]
  let minDiff = Infinity

  for (const ratio of availableRatios) {
    const [w, h] = ratio.split(':').map(Number)
    const ratioValue = w / h
    const diff = Math.abs(ratioValue - imageRatio)

    if (diff < minDiff) {
      minDiff = diff
      closestRatio = ratio
    }
  }

  return closestRatio
}

/**
 * 常用的宽高比列表
 */
export const QWEN_ASPECT_RATIOS = [
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
