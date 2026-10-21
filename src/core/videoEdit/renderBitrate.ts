/**
 * 预渲染与代理的目标码率：以 H.264 4K60 40Mbps 为基准，按像素率的 0.75 次方缩放（码率增长慢于像素率：
 * 画面越大、帧越密，相邻像素与相邻帧越相似），最低 6Mbps；HEVC 同画质约省三分之一（×0.65），高画质 ×1.5。
 * 参考：4K60 40、4K30 约 24、1440p60 约 22、1080p60 约 14、1080p30 约 8（H.264 标准画质）。
 */
export const RENDER_BITRATE_BASE_MBPS = 40
export const RENDER_BITRATE_MIN_MBPS = 6
const BASE_PIXEL_RATE = 3840 * 2160 * 60

export function renderBitrateMbps(input: { width: number; height: number; fps: number; codec: 'avc' | 'hevc'; quality: 'standard' | 'high' }): number {
  const ratio = Math.max(0, input.width * input.height * input.fps) / BASE_PIXEL_RATE
  const base = Math.max(RENDER_BITRATE_MIN_MBPS, RENDER_BITRATE_BASE_MBPS * ratio ** 0.75)
  const value = base * (input.codec === 'hevc' ? 0.65 : 1) * (input.quality === 'high' ? 1.5 : 1)
  return Math.round(value * 10) / 10
}
