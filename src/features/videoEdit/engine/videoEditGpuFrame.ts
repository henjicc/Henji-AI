import type { VideoSample } from 'mediabunny'
import type { GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'

/**
 * Colour formats of the compositor's composition targets and effect surfaces (task 2.7, record 013). 8-bit material
 * keeps `rgba8unorm`; frames with high-precision pictures compose and run effects/transitions in `rgba16float`, and are
 * quantized only when they reach the 8-bit canvas.
 */
export type VideoEditGpuColorFormat = 'rgba8unorm' | 'rgba16float'
export const VIDEO_EDIT_PRECISE_FORMAT: VideoEditGpuColorFormat = 'rgba16float'
export function videoEditGpuBytesPerPixel(format: VideoEditGpuColorFormat): number { return format === 'rgba16float' ? 8 : 4 }
/**
 * Owned picture formats (non-compact snapshots): `rgba8unorm` for 8-bit pictures; `rgb10a2unorm` for opaque pictures
 * of at most 10 bits (exactly 10 bits per colour, 4 bytes per pixel: the frame cache holds as many 4K frames as
 * before task 2.7); `rgba16float` for pictures with alpha or more than 10 bits (8 bytes per pixel).
 */
export type VideoEditOwnedFormat = 'rgba8unorm' | 'rgb10a2unorm' | 'rgba16float'
/** The decoded stream's bit depth and alpha, from the native decoder's details. */
export interface VideoEditSourceDepth { bitDepth: number | null; hasAlpha: boolean }

/** One format policy for seek, playback and export. Opaque 8-bit AVC frames
 * retain the existing full-resolution luma / original 4:2:0 chroma budget. */
export function videoEditGpuFrameUsesChroma(sample: Pick<VideoSample, 'format'>, codec?: string): boolean {
  return sample.format === 'I420' || sample.format === 'NV12' || (sample.format === null && !!codec && /^avc[13]\.(42|4d|58|64)/i.test(codec))
}

/**
 * Owned format of a non-compact picture.
 * - Native pictures: the native service delivers `nv12` only for 8-bit 4:2:0 and `rgbaf16` (format null) for every
 *   other material (record 007); the decoder's bit depth and alpha then choose `rgb10a2unorm` (opaque, at most 10 bits)
 *   or `rgba16float` (alpha, 12-bit, or unknown).
 * - Browser pictures: only WebCodecs' named 10/12-bit layouts (`I420P10`, `I444AP12`, ...). Hardware frames have no
 *   format, and Chromium imports 10-bit hardware frames with 8-bit precision (task 2.7 measurement: HEVC Main10 and
 *   VP9 profile 2 read back 254 levels, 44 dB, against 877 levels, 73 dB natively), so they stay `rgba8unorm`.
 * Compact 4:2:0 pictures (`videoEditGpuFrameUsesChroma`) never come here.
 */
export function videoEditGpuFrameFormat(sample: Pick<VideoSample, 'format'>, native?: VideoEditSourceDepth): VideoEditOwnedFormat {
  const format = sample.format as string | null
  if (format) {
    const deep = /(A?)P1([026])$/.exec(format)
    return !deep ? 'rgba8unorm' : deep[1] || deep[2] !== '0' ? 'rgba16float' : 'rgb10a2unorm'
  }
  if (!native) return 'rgba8unorm'
  return native.hasAlpha || native.bitDepth === null || native.bitDepth > 10 ? 'rgba16float' : 'rgb10a2unorm'
}

/** Whether a compositor input (owned frame or code surface) holds high-precision pixels. */
export function videoEditPictureHighPrecision(picture: unknown): boolean {
  return typeof picture === 'object' && picture !== null && 'highPrecision' in picture && picture.highPrecision === true
}

/** Independent texture ownership: cached frames never pin decoder surfaces. */
export class VideoEditGpuFrame {
  private closed = false
  readonly timestamp: number
  readonly duration: number
  readonly displayWidth: number
  readonly displayHeight: number
  readonly rotation: VideoSample['rotation']
  readonly flip: boolean
  private readonly resource: { texture: GpuTexture; chroma?: GpuTexture; references: number; bytes: number; release: () => void; highPrecision: boolean }
  constructor(sample: Pick<VideoSample, 'timestamp' | 'duration' | 'displayWidth' | 'displayHeight' | 'rotation' | 'flip'>, texture: GpuTexture, chroma: GpuTexture | undefined, bytes: number, release = () => { texture.destroy(); chroma?.destroy() }, shared?: VideoEditGpuFrame['resource'], highPrecision = false) {
    this.timestamp = sample.timestamp; this.duration = sample.duration
    this.displayWidth = sample.displayWidth; this.displayHeight = sample.displayHeight
    this.rotation = sample.rotation; this.flip = sample.flip
    this.resource = shared ?? { texture, chroma, bytes, release, references: 1, highPrecision }
  }
  get texture(): GpuTexture { if (this.closed) throw new Error('预览帧已释放。'); return this.resource.texture }
  get chroma(): GpuTexture | undefined { if (this.closed) throw new Error('预览帧已释放。'); return this.resource.chroma }
  /** True when the texture is `rgb10a2unorm` or `rgba16float` (more than 8 bits per colour). */
  get highPrecision(): boolean { return this.resource.highPrecision }
  allocationSize(): number { return this.resource.bytes }
  clone(): VideoEditGpuFrame {
    if (this.closed) throw new Error('预览帧已释放。')
    this.resource.references++
    return new VideoEditGpuFrame(this, this.resource.texture, this.resource.chroma, this.resource.bytes, this.resource.release, this.resource)
  }
  /**
   * The same picture shown for `duration` seconds: a picture stays until the next one starts, so a decoder duration
   * shorter than that gap (variable frame rate, inaccurate durations) is widened to it (task 3.1). Shares the texture.
   */
  retimed(duration: number): VideoEditGpuFrame {
    if (this.closed) throw new Error('预览帧已释放。')
    this.resource.references++
    return new VideoEditGpuFrame({ timestamp: this.timestamp, duration, displayWidth: this.displayWidth, displayHeight: this.displayHeight, rotation: this.rotation, flip: this.flip }, this.resource.texture, this.resource.chroma, this.resource.bytes, this.resource.release, this.resource)
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    if (--this.resource.references === 0) this.resource.release()
  }
}
