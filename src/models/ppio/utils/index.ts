/**
 * PPIO 模型工具函数
 *
 * 提供各种模型共享的辅助函数
 */

/**
 * 规范化海螺参数
 * 用于 Minimax Hailuo 2.3 和 Hailuo 02
 */
export function normalizeHailuo(duration?: number, resolution?: string): { duration: number; resolution: string } {
  const d = duration === 10 ? 10 : 6
  const rInput = (resolution || '').toUpperCase()
  const r = d === 10 ? '768P' : (rInput === '1080P' ? '1080P' : '768P')
  return { duration: d, resolution: r }
}

/**
 * 规范化 PixVerse 分辨率
 * 用于 PixVerse V4.5
 */
export function normalizePixverseResolution(resolution?: string): string {
  const s = (resolution || '').toLowerCase()
  const allowed = ['360p', '540p', '720p', '1080p']
  return allowed.includes(s) ? s : '540p'
}
