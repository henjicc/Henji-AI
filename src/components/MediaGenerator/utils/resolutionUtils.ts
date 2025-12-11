/**
 * 分辨率计算工具函数
 */

// 预设分辨率选项 - 2K基础分辨率
import { logInfo } from '../../../utils/errorLogger'
export const baseResolutions: Record<string, string> = {
  '1:1': '2048x2048',
  '4:3': '2304x1728',
  '3:4': '1728x2304',
  '16:9': '2560x1440',
  '9:16': '1440x2560',
  '3:2': '2496x1664',
  '2:3': '1664x2496',
  '21:9': '3024x1296'
}

// 标准宽高比列表（用于智能匹配）
const standardAspectRatios = [
  { ratio: '21:9', value: 21 / 9 },
  { ratio: '16:9', value: 16 / 9 },
  { ratio: '3:2', value: 3 / 2 },
  { ratio: '4:3', value: 4 / 3 },
  { ratio: '1:1', value: 1 / 1 },
  { ratio: '3:4', value: 3 / 4 },
  { ratio: '2:3', value: 2 / 3 },
  { ratio: '9:16', value: 9 / 16 },
  { ratio: '9:21', value: 9 / 21 }
]

/**
 * 从图片计算最接近的标准宽高比
 * @param imageDataUrl 图片的 data URL
 * @returns Promise<string> 返回最接近的标准比例（如 "16:9"）
 */
export const calculateAspectRatioFromImage = (imageDataUrl: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const width = img.width
      const height = img.height
      const actualRatio = width / height

      // 找到最接近的标准比例
      let closestRatio = '16:9'
      let minDifference = Infinity

      for (const standard of standardAspectRatios) {
        const difference = Math.abs(actualRatio - standard.value)
        if (difference < minDifference) {
          minDifference = difference
          closestRatio = standard.ratio
        }
      }

      logInfo('[resolutionUtils] 智能比例匹配:', {
        原图尺寸: `${width}x${height}`,
        实际比例: actualRatio.toFixed(4),
        匹配结果: closestRatio,
        匹配比例值: standardAspectRatios.find(s => s.ratio === closestRatio)?.value.toFixed(4),
        差异: minDifference.toFixed(4)
      })

      resolve(closestRatio)
    }
    img.src = imageDataUrl
  })
}

// 根据质量获取实际分辨率
export const getActualResolution = (ratio: string, quality: '2K' | '4K'): string => {
  const base = baseResolutions[ratio]
  if (!base) return base

  if (quality === '4K') {
    const [w, h] = base.split('x').map(Number)
    return `${w * 2}x${h * 2}`
  }
  return base
}

// 计算智能分辨率(基于第一张图片)
export const calculateSmartResolution = (imageDataUrl: string, quality: '2K' | '4K'): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const originalWidth = img.width
      const originalHeight = img.height
      const aspectRatio = originalWidth / originalHeight

      // 检查宽高比范围 [1/16, 16]
      if (aspectRatio < 1 / 16 || aspectRatio > 16) {
        // 超出范围,使用默认 1:1
        resolve(quality === '2K' ? '2048x2048' : '4096x4096')
        return
      }

      const maxPixels = quality === '2K' ? 4194304 : 16777216 // 2K: 2048*2048, 4K: 4096*4096

      // 优化算法：在保持原图比例的前提下，让分辨率尽可能接近目标像素数
      // 计算能达到目标像素数的理想尺寸
      const targetHeight = Math.sqrt(maxPixels / aspectRatio)
      const targetWidth = targetHeight * aspectRatio

      // 取整到合理的值（8的倍数，便于编码）
      let width = Math.floor(targetWidth / 8) * 8
      let height = Math.floor(targetHeight / 8) * 8

      // 2K模式：允许略微超过目标像素（最多105%），以更接近理想尺寸
      // 4K模式：严格不超过目标像素
      if (quality === '2K') {
        // 2K模式：如果当前尺寸略小，尝试增加到8的倍数，允许略微超过
        const currentPixels = width * height
        if (currentPixels < maxPixels) {
          // 尝试增加宽度或高度，看是否能更接近目标
          const withExtraWidth = (width + 8) * height
          const withExtraHeight = width * (height + 8)

          // 选择更接近目标且不超过105%的方案
          const maxAllowed = maxPixels * 1.05
          if (withExtraWidth <= maxAllowed && Math.abs(withExtraWidth - maxPixels) < Math.abs(currentPixels - maxPixels)) {
            width += 8
          } else if (withExtraHeight <= maxAllowed && Math.abs(withExtraHeight - maxPixels) < Math.abs(currentPixels - maxPixels)) {
            height += 8
          }
        }
      } else {
        // 4K模式：严格确保不超过最大像素限制
        if (width * height > maxPixels) {
          // 微调：减小尺寸确保不超过限制
          const scale = Math.sqrt(maxPixels / (width * height))
          width = Math.floor(width * scale / 8) * 8
          height = Math.floor(height * scale / 8) * 8
        }
      }

      // 确保最小尺寸（至少512像素）
      if (width < 512) width = 512
      if (height < 512) height = 512

      // 最终验证：4K模式严格检查，2K模式允许105%
      const finalPixels = width * height
      const maxAllowed = quality === '2K' ? maxPixels * 1.05 : maxPixels
      if (finalPixels > maxAllowed) {
        const scale = Math.sqrt(maxAllowed / finalPixels)
        width = Math.floor(width * scale / 8) * 8
        height = Math.floor(height * scale / 8) * 8
      }

      logInfo('[resolutionUtils] 智能分辨率计算:', {
        原图尺寸: `${originalWidth}x${originalHeight}`,
        宽高比: aspectRatio.toFixed(3),
        质量模式: quality,
        目标像素: maxPixels,
        计算结果: `${width}x${height}`,
        实际像素: width * height,
        利用率: `${((width * height / maxPixels) * 100).toFixed(1)}%`,
        允许超限: quality === '2K' ? '是(105%)' : '否(严格)'
      })

      resolve(`${width}x${height}`)
    }
    img.src = imageDataUrl
  })
}

/**
 * 派欧云即梦专用智能分辨率算法
 * 支持完全精确匹配原图比例，不限制于预设比例
 *
 * 约束条件（派欧云限制）：
 * - 宽高比范围：[1/16, 16]
 * - 最小尺寸：宽度和高度都 > 14 像素
 * - 最大总像素：严格不超过 4096×4096 = 16,777,216 像素
 * - 2K模式：接近但不小于 2048×2048 = 4,194,304 像素，不超过 4096×4096
 * - 4K模式：接近但不小于且不超过 4096×4096 = 16,777,216 像素
 */
export const calculatePPIOSeedreamSmartResolution = (imageDataUrl: string, quality: '2K' | '4K'): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const originalWidth = img.width
      const originalHeight = img.height
      const aspectRatio = originalWidth / originalHeight

      // 检查宽高比范围 [1/16, 16]
      if (aspectRatio < 1 / 16 || aspectRatio > 16) {
        // 超出范围，使用默认 1:1
        resolve(quality === '2K' ? '2048x2048' : '4096x4096')
        return
      }

      // 目标像素数
      const targetPixels = quality === '2K' ? 4194304 : 16777216 // 2K: 2048*2048, 4K: 4096*4096
      const absoluteMaxPixels = 16777216 // 4096*4096 派欧云绝对上限

      // 计算能达到目标像素数的理想尺寸（保持原图精确比例）
      const targetHeight = Math.sqrt(targetPixels / aspectRatio)
      const targetWidth = targetHeight * aspectRatio

      // 直接取整（不强制8的倍数，以获得更精确的比例匹配）
      let width = Math.round(targetWidth)
      let height = Math.round(targetHeight)

      let currentPixels = width * height

      // 确保不小于目标像素数，但严格不超过绝对上限
      while (currentPixels < targetPixels && currentPixels < absoluteMaxPixels) {
        const withExtraWidth = (width + 1) * height
        const withExtraHeight = width * (height + 1)

        // 选择增加后更接近目标且不超过绝对上限的方案
        if (withExtraWidth <= absoluteMaxPixels && withExtraHeight <= absoluteMaxPixels) {
          // 两者都可以，选择更接近目标的
          if (Math.abs(withExtraWidth - targetPixels) < Math.abs(withExtraHeight - targetPixels)) {
            width += 1
            currentPixels = withExtraWidth
          } else {
            height += 1
            currentPixels = withExtraHeight
          }
        } else if (withExtraWidth <= absoluteMaxPixels) {
          width += 1
          currentPixels = withExtraWidth
        } else if (withExtraHeight <= absoluteMaxPixels) {
          height += 1
          currentPixels = withExtraHeight
        } else {
          // 无法继续增加
          break
        }
      }

      // 严格确保不超过绝对上限
      if (currentPixels > absoluteMaxPixels) {
        const scale = Math.sqrt(absoluteMaxPixels / currentPixels)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
        currentPixels = width * height
      }

      // 确保最小尺寸（至少15像素，满足 > 14 的要求）
      if (width < 15) width = 15
      if (height < 15) height = 15

      // 最终验证宽高比是否仍在范围内
      const finalRatio = width / height
      if (finalRatio < 1 / 16 || finalRatio > 16) {
        // 如果调整后超出范围，回退到默认
        resolve(quality === '2K' ? '2048x2048' : '4096x4096')
        return
      }

      // 最终像素数检查
      const finalPixels = width * height
      if (finalPixels > absoluteMaxPixels) {
        // 如果超过绝对上限，按比例缩小
        const scale = Math.sqrt(absoluteMaxPixels / finalPixels)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }

      logInfo('[resolutionUtils] 派欧云即梦智能分辨率计算:', {
        原图尺寸: `${originalWidth}x${originalHeight}`,
        原图宽高比: aspectRatio.toFixed(4),
        质量模式: quality,
        目标像素: targetPixels,
        计算结果: `${width}x${height}`,
        结果宽高比: (width / height).toFixed(4),
        比例偏差: Math.abs(aspectRatio - (width / height)).toFixed(6),
        实际像素: width * height,
        利用率: `${((width * height / targetPixels) * 100).toFixed(2)}%`,
        是否达标: width * height >= targetPixels ? '是' : '否',
        是否超限: width * height > absoluteMaxPixels ? '是（超过派欧云上限）' : '否'
      })

      resolve(`${width}x${height}`)
    }
    img.src = imageDataUrl
  })
}

/**
 * 即梦专用智能分辨率算法（fal.ai）
 * 支持完全精确匹配原图比例，不限制于预设比例
 *
 * 约束条件：
 * - 宽高比范围：[1/3, 3]
 * - 最小尺寸：宽度和高度都 > 14 像素
 * - 最大总像素：不超过 6000×6000 = 36,000,000 像素
 * - 2K模式：接近但不小于 2048×2048 = 4,194,304 像素
 * - 4K模式：接近但不小于 4096×4096 = 16,777,216 像素
 */
export const calculateSeedreamSmartResolution = (imageDataUrl: string, quality: '2K' | '4K'): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const originalWidth = img.width
      const originalHeight = img.height
      const aspectRatio = originalWidth / originalHeight

      // 检查宽高比范围 [1/3, 3]
      if (aspectRatio < 1 / 3 || aspectRatio > 3) {
        // 超出范围，使用默认 1:1
        resolve(quality === '2K' ? '2048x2048' : '4096x4096')
        return
      }

      // 目标像素数
      const targetPixels = quality === '2K' ? 4194304 : 16777216 // 2K: 2048*2048, 4K: 4096*4096
      const absoluteMaxPixels = 36000000 // 6000*6000 绝对上限

      // 计算能达到目标像素数的理想尺寸（保持原图精确比例）
      const targetHeight = Math.sqrt(targetPixels / aspectRatio)
      const targetWidth = targetHeight * aspectRatio

      // 直接取整（不强制8的倍数，以获得更精确的比例匹配）
      let width = Math.round(targetWidth)
      let height = Math.round(targetHeight)

      let currentPixels = width * height
      const maxAllowedPixels = Math.min(targetPixels * 1.05, absoluteMaxPixels) // 允许超过5%，但不超过绝对上限

      // 2K和4K模式：确保始终不小于目标像素数
      // 如果当前像素数小于目标，逐步增加直到达到或超过目标
      while (currentPixels < targetPixels && currentPixels < maxAllowedPixels) {
        const withExtraWidth = (width + 1) * height
        const withExtraHeight = width * (height + 1)

        // 选择增加后更接近目标且不超过最大限制的方案
        if (withExtraWidth <= maxAllowedPixels && withExtraHeight <= maxAllowedPixels) {
          // 两者都可以，选择更接近目标的
          if (Math.abs(withExtraWidth - targetPixels) < Math.abs(withExtraHeight - targetPixels)) {
            width += 1
            currentPixels = withExtraWidth
          } else {
            height += 1
            currentPixels = withExtraHeight
          }
        } else if (withExtraWidth <= maxAllowedPixels) {
          width += 1
          currentPixels = withExtraWidth
        } else if (withExtraHeight <= maxAllowedPixels) {
          height += 1
          currentPixels = withExtraHeight
        } else {
          // 无法继续增加
          break
        }
      }

      // 确保不超过最大允许像素
      if (currentPixels > maxAllowedPixels) {
        const scale = Math.sqrt(maxAllowedPixels / currentPixels)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
        currentPixels = width * height
      }

      // 确保最小尺寸（至少15像素，满足 > 14 的要求）
      if (width < 15) width = 15
      if (height < 15) height = 15

      // 最终验证宽高比是否仍在范围内
      const finalRatio = width / height
      if (finalRatio < 1 / 3 || finalRatio > 3) {
        // 如果调整后超出范围，回退到默认
        resolve(quality === '2K' ? '2048x2048' : '4096x4096')
        return
      }

      // 最终像素数检查
      const finalPixels = width * height
      if (finalPixels > absoluteMaxPixels) {
        // 如果超过绝对上限，按比例缩小
        const scale = Math.sqrt(absoluteMaxPixels / finalPixels)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }

      logInfo('[resolutionUtils] 即梦智能分辨率计算:', {
        原图尺寸: `${originalWidth}x${originalHeight}`,
        原图宽高比: aspectRatio.toFixed(4),
        质量模式: quality,
        目标像素: targetPixels,
        计算结果: `${width}x${height}`,
        结果宽高比: (width / height).toFixed(4),
        比例偏差: Math.abs(aspectRatio - (width / height)).toFixed(6),
        实际像素: width * height,
        利用率: `${((width * height / targetPixels) * 100).toFixed(2)}%`,
        超出目标: width * height > targetPixels ? `+${(((width * height / targetPixels) - 1) * 100).toFixed(2)}%` : '否'
      })

      resolve(`${width}x${height}`)
    }
    img.src = imageDataUrl
  })
}
