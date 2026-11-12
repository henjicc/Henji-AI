/**
 * 界面上的规格写法（分辨率、帧率、码率、文件大小、采样率、编码名）只在这里生成，
 * 写法表见 docs/rules/frontend-ui.md「界面文案里的规格写法」。只用于显示，取值、文件名与请求参数不经过这里。
 */

/** 去掉多余小数：29.97002997 → 29.97，48.0 → 48。 */
const trimNumber = (value: number, digits = 3): string => Number(value.toFixed(digits)).toString()

/** 分辨率写法统一大写：480p → 480P、4k → 4K，其余文字不动。 */
export function formatResolutionText(text: string): string {
  return text.replace(/\b(\d{3,4})p\b/g, '$1P').replace(/\b(\d(?:\.\d)?)k\b/g, '$1K')
}

/** 帧率：完整写法 `60 帧/秒`；一行摘要、选项等空间紧的地方用 `60fps`。 */
export function formatFrameRate(fps: number, style: 'full' | 'compact' = 'full'): string {
  return style === 'compact' ? `${trimNumber(fps)}fps` : `${trimNumber(fps)} 帧/秒`
}

/** 带中英文的帧率文字：中文完整写法，英文统一写 fps。 */
export function frameRateText(fps: number): { zh: string; en: string } {
  return { zh: formatFrameRate(fps), en: formatFrameRate(fps, 'compact') }
}

export function formatMbps(mbps: number): string {
  return `${trimNumber(mbps, 2)} Mbps`
}

export function formatKbps(kbps: number): string {
  return `${trimNumber(kbps, 0)} kbps`
}

/** 采样率：48000 → 48 kHz，44100 → 44.1 kHz。 */
export function formatSampleRate(hz: number): string {
  return `${trimNumber(hz / 1000)} kHz`
}

/** 文件大小按 1024 进位：不足 10 保留一位小数（1.4 GB），其余取整（346 MB）。 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value < 10 ? trimNumber(value, 1) : Math.round(value)} ${units[unit]}`
}

const VIDEO_CODEC_LABELS: Record<string, string> = { avc: 'H.264', h264: 'H.264', hevc: 'H.265', h265: 'H.265', av1: 'AV1', vp9: 'VP9', prores: 'ProRes' }

/** 视频编码的显示名：avc → H.264、hevc → H.265；不认识的原样返回。 */
export function videoCodecLabel(codec: string): string {
  return VIDEO_CODEC_LABELS[codec.toLowerCase()] ?? codec
}
