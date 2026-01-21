/**
 * 智能匹配工具
 *
 * 用于图片/视频上传后自动匹配最佳参数
 */

/**
 * 计算图片的宽高比并匹配最接近的标准比例
 */
export function calculateAspectRatio(width: number, height: number): string {
  const ratio = width / height

  // 标准比例列表
  const ratios: Record<string, number> = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '1:1': 1,
    '4:3': 4 / 3,
    '3:4': 3 / 4,
    '21:9': 21 / 9,
    '9:21': 9 / 21
  }

  let closest = '16:9'
  let minDiff = Math.abs(ratio - ratios['16:9'])

  for (const [key, value] of Object.entries(ratios)) {
    const diff = Math.abs(ratio - value)
    if (diff < minDiff) {
      minDiff = diff
      closest = key
    }
  }

  return closest
}

/**
 * 计算最大公约数（用于简化比例）
 */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * 将宽高转换为简化的比例字符串
 */
export function simplifyRatio(width: number, height: number): string {
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}
