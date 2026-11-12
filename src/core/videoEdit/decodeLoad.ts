/**
 * 实时播放的解码负载估算：同时要解的几路视频合计占用多少显卡解码能力，与本机能力比较，判断会不会卡。
 *
 * 单位是“参考路”：一路 4K60 H.264 150Mbps 8 位 4:2:0 原片记为 1。每路的代价按“每帧固定开销（随像素数）+ 每比特开销
 * （随码率）”两项相加，编码不同系数不同（HEVC 熵解码每比特更贵、每像素更便宜）。系数由 RTX 4090 上 4K60 的四个实测
 * 吞吐点解出，只用于定出各种素材之间的相对代价：
 *   H.264 150Mbps 约 220 帧/秒，50Mbps 约 260；H.265 150Mbps 约 255，50Mbps（8/10 位）约 470。
 * 本机能装下多少参考路不写死：先用保守的默认值，实际播放后按观测修正（`videoEditLearnDecodeCapacity`）。
 */

/** 估算要用到的素材信息；码率缺失时按参考素材的每像素码率推算（宁可估高）。 */
export interface VideoEditDecodeStream {
  codec: string | null
  width: number
  height: number
  fps: number
  bitRate?: number | null
  bitDepth?: number | null
  /** 如 `4:2:0`、`4:2:2`；缺失按 4:2:0。 */
  chroma?: string | null
}

const REFERENCE_PIXELS = 3840 * 2160
const REFERENCE_FPS = 60
const REFERENCE_BITRATE = 150e6
/** 每个 4K 帧的固定开销（毫秒）与每兆比特开销（毫秒），由上面四个实测点解出。 */
const COEFFICIENTS = { h264: { frame: 3.5, megabit: .42 }, hevc: { frame: 1.23, megabit: 1.075 } } as const
/** 参考路每秒占用的解码时间（毫秒）：60 帧 × (3.5 + 0.42 × 2.5)。 */
const REFERENCE_MS = REFERENCE_FPS * (COEFFICIENTS.h264.frame + COEFFICIENTS.h264.megabit * REFERENCE_BITRATE / REFERENCE_FPS / 1e6)
/** 显卡解不了、要靠处理器解的格式按三倍计：4K 软解每秒只有几十帧。 */
const SOFTWARE_FACTOR = 3
/**
 * 没有观测时假定本机能装下的参考路数。比 4090 实测的约 3.7 路低：解码单元更少的显卡第一次播放就会被观测修正，
 * 在那之前宁可多提示一次。
 */
export const VIDEO_EDIT_DEFAULT_DECODE_CAPACITY = 3

const chroma420 = (chroma: string | null | undefined): boolean => !chroma || chroma === '4:2:0'
/** 显卡（NVDEC / VideoToolbox 常见能力）能解的格式：H.264 只到 8 位 4:2:0，HEVC、AV1、VP9 到 10 位 4:2:0。 */
export function videoEditHardwareDecodable(stream: Pick<VideoEditDecodeStream, 'codec' | 'bitDepth' | 'chroma'>): boolean {
  const depth = stream.bitDepth ?? 8
  if (!chroma420(stream.chroma)) return false
  if (stream.codec === 'h264') return depth <= 8
  return ['hevc', 'av1', 'vp9'].includes(stream.codec ?? '') && depth <= 10
}

/** 一路的代价（参考路）。 */
export function videoEditDecodeCost(stream: VideoEditDecodeStream): number {
  const fps = stream.fps > 0 ? stream.fps : 30
  const pixels = Math.max(1, stream.width * stream.height)
  const bitRate = stream.bitRate && stream.bitRate > 0 ? stream.bitRate : REFERENCE_BITRATE * pixels / REFERENCE_PIXELS * fps / REFERENCE_FPS
  const coefficients = ['hevc', 'av1', 'vp9'].includes(stream.codec ?? '') ? COEFFICIENTS.hevc : COEFFICIENTS.h264
  const ms = fps * coefficients.frame * pixels / REFERENCE_PIXELS + coefficients.megabit * bitRate / 1e6
  return ms / REFERENCE_MS * (videoEditHardwareDecodable(stream) ? 1 : SOFTWARE_FACTOR)
}

/**
 * 按一次逐帧解的实际播放修正本机能力：估算带得动却明显丢帧，能力降到这次负载以下，之后同样的负载判为带不动。
 * 只解参考帧的播放本来就不逐帧，不说明能力，调用方不交给这里。
 */
export function videoEditLearnDecodeCapacity(capacity: number, observed: { load: number; droppedRatio: number }): number {
  return observed.load > 0 && observed.load <= capacity && observed.droppedRatio >= .15 ? observed.load * .95 : capacity
}
