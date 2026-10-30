/**
 * 预渲染与代理的目标码率，以清晰为主（用户 2026-10-21 确认）：H.264 查表加插值。
 *
 * | 分辨率 | 30fps | 60fps |
 * |---|---|---|
 * | 4K（3840×2160） | 40 | 50 |
 * | 1440p | 25 | 30 |
 * | 1080p 及以下 | 20 | 20 |
 *
 * - 介于两档之间按像素数线性插值；高于 4K 按像素数与 4K 的比例放大。帧率在 30–60 之间线性插值，
 *   低于 30 按 30 档；高于 60 按帧率比例增加，最多到 60fps 那档的 2 倍。
 * - HEVC 用同一张表 ×0.7；任何编码都不低于 20Mbps。“高”画质再 ×1.3。
 * - 代理按代理自身的分辨率与帧率查同一张表。
 */
export const RENDER_BITRATE_MIN_MBPS = 20
const TIERS: ReadonlyArray<{ pixels: number; fps30: number; fps60: number }> = [
  { pixels: 1920 * 1080, fps30: 20, fps60: 20 },
  { pixels: 2560 * 1440, fps30: 25, fps60: 30 },
  { pixels: 3840 * 2160, fps30: 40, fps60: 50 },
]

/** 某一像素数下 30fps 与 60fps 的 H.264 码率。 */
function tierAt(pixels: number): { fps30: number; fps60: number } {
  const first = TIERS[0], last = TIERS[TIERS.length - 1]
  if (pixels <= first.pixels) return first
  if (pixels >= last.pixels) { const scale = pixels / last.pixels; return { fps30: last.fps30 * scale, fps60: last.fps60 * scale } }
  const upper = TIERS.findIndex(tier => tier.pixels >= pixels)
  const low = TIERS[upper - 1], high = TIERS[upper]
  const t = (pixels - low.pixels) / (high.pixels - low.pixels)
  return { fps30: low.fps30 + (high.fps30 - low.fps30) * t, fps60: low.fps60 + (high.fps60 - low.fps60) * t }
}

export function renderBitrateMbps(input: { width: number; height: number; fps: number; codec: 'avc' | 'hevc'; quality: 'standard' | 'high' }): number {
  const tier = tierAt(Math.max(0, input.width * input.height))
  const fps = Math.max(0, input.fps)
  const avc = fps <= 30 ? tier.fps30
    : fps <= 60 ? tier.fps30 + (tier.fps60 - tier.fps30) * (fps - 30) / 30
      : Math.min(tier.fps60 * 2, tier.fps60 * fps / 60)
  const value = Math.max(RENDER_BITRATE_MIN_MBPS, avc * (input.codec === 'hevc' ? 0.7 : 1)) * (input.quality === 'high' ? 1.3 : 1)
  return Math.round(value * 10) / 10
}

/**
 * 预渲染文件的编码参数（纯函数）。WebCodecs 硬件编码，播放与任意帧定位共用：
 * - VBR，目标码率按上表。
 * - 每帧强制关键帧（WebCodecs 关键帧为 IDR），精确缓存定位只需解目标一帧。
 * - H.264 High / HEVC Main，8 位 4:2:0（画布帧经编码器转 YUV）；色彩标记由编码器按 BT.709 写入。
 * 参数含义变化时递增 RENDER_ENCODING_VERSION：它进入编码档案与缓存键，旧文件随之按需要渲染处理。
 */
export const RENDER_ENCODING_VERSION = 3
export interface VideoEditRenderEncoding {
  codec: 'avc' | 'hevc'; bitrateMbps: number; bitrateMode: 'vbr'; encoderPreference: 'hardware'; keyframeInterval: number
  /** 进入缓存键的编码档案。 */
  profile: string
}
export function videoEditRenderEncoding(sequence: { width: number; height: number; fps: number }, codec: 'avc' | 'hevc', quality: 'standard' | 'high'): VideoEditRenderEncoding {
  const bitrateMbps = renderBitrateMbps({ ...sequence, codec, quality })
  return { codec, bitrateMbps, bitrateMode: 'vbr', encoderPreference: 'hardware', keyframeInterval: 1 / sequence.fps, profile: `v${RENDER_ENCODING_VERSION}:${codec}:${quality}:${bitrateMbps}` }
}
