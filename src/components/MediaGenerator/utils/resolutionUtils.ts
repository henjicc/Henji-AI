/**
 * 分辨率计算工具函数
 */

// 预设分辨率选项 - 2K基础分辨率
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

      console.log('[resolutionUtils] 智能分辨率计算:', {
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
