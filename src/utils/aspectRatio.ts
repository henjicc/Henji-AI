/**
 * 宽高比智能匹配工具
 * 用于根据上传图片的宽高比，自动匹配最接近的预设值
 */

/**
 * 从图片 Data URL 获取宽高比
 * @param imageDataUrl 图片的 Data URL
 * @returns Promise<number> 宽高比（宽/高）
 */
export async function getImageAspectRatio(imageDataUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const ratio = img.width / img.height
      resolve(ratio)
    }
    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }
    img.src = imageDataUrl
  })
}

/**
 * 根据图片宽高比，匹配最接近的预设值
 * @param imageRatio 图片的宽高比
 * @param options 可选的预设值列表
 * @param extractRatio 从预设值提取宽高比的函数
 * @returns 最接近的预设值
 */
export function matchClosestAspectRatio(
  imageRatio: number,
  options: Array<{ value: any; label: string }>,
  extractRatio: (value: any) => number | null
): any {
  let closestValue = options[0].value
  let minDiff = Infinity

  for (const option of options) {
    const optionRatio = extractRatio(option.value)
    if (optionRatio === null) continue // 跳过 'auto' 等特殊值

    const diff = Math.abs(imageRatio - optionRatio)
    if (diff < minDiff) {
      minDiff = diff
      closestValue = option.value
    }
  }

  return closestValue
}

/**
 * 从宽高比字符串提取数值比例
 * @param aspectRatio 宽高比字符串，如 '16:9', '1:1'
 * @returns 数值比例（宽/高）
 */
export function parseAspectRatio(aspectRatio: string): number | null {
  if (aspectRatio === 'auto' || aspectRatio === '智能') return null

  const parts = aspectRatio.split(':')
  if (parts.length !== 2) return null

  const [w, h] = parts.map(Number)
  if (isNaN(w) || isNaN(h) || h === 0) return null

  return w / h
}

/**
 * 从尺寸字符串提取宽高比
 * @param size 尺寸字符串，如 '1920*1080', '832*480'
 * @returns 数值比例（宽/高）
 */
export function parseSizeRatio(size: string): number | null {
  if (size === 'auto' || size === '智能') return null

  const parts = size.split('*')
  if (parts.length !== 2) return null

  const [w, h] = parts.map(Number)
  if (isNaN(w) || isNaN(h) || h === 0) return null

  return w / h
}

/**
 * 计算宽高比对应的可视化尺寸（用于显示矩形图标）
 * @param ratio 宽高比
 * @param maxSize 最大尺寸（像素）
 * @returns { width: number, height: number }
 */
export function calculateVisualizationSize(ratio: number, maxSize: number = 32): { width: number; height: number } {
  if (ratio >= 1) {
    // 横向或正方形
    return {
      width: maxSize,
      height: Math.round(maxSize / ratio)
    }
  } else {
    // 竖向
    return {
      width: Math.round(maxSize * ratio),
      height: maxSize
    }
  }
}

/**
 * 格式化宽高比为显示文本
 * @param ratio 数值比例
 * @returns 格式化的字符串，如 '16:9', '1:1'
 */
export function formatAspectRatio(ratio: number): string {
  // 常见比例的映射
  const commonRatios: Record<string, string> = {
    '2.333': '21:9',
    '2.370': '21:9',
    '1.778': '16:9',
    '1.777': '16:9',
    '1.500': '3:2',
    '1.333': '4:3',
    '1.250': '5:4',
    '1.000': '1:1',
    '0.800': '4:5',
    '0.750': '3:4',
    '0.667': '2:3',
    '0.563': '9:16',
    '0.562': '9:16',
    '0.429': '9:21',
    '0.422': '9:21'
  }

  const ratioStr = ratio.toFixed(3)
  if (commonRatios[ratioStr]) {
    return commonRatios[ratioStr]
  }

  // 如果不是常见比例，尝试简化
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const w = Math.round(ratio * 100)
  const h = 100
  const divisor = gcd(w, h)

  return `${w / divisor}:${h / divisor}`
}
