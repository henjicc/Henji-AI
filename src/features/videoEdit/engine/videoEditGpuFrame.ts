import type { VideoSample } from 'mediabunny'
import type { GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'

/** One format policy for seek, playback and export. Opaque 8-bit AVC frames
 * retain the existing full-resolution luma / original 4:2:0 chroma budget. */
export function videoEditGpuFrameUsesChroma(sample: Pick<VideoSample, 'format'>, codec?: string): boolean {
  return sample.format === 'I420' || sample.format === 'NV12' || (sample.format === null && !!codec && /^avc[13]\.(42|4d|58|64)/i.test(codec))
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
  private readonly resource: { texture: GpuTexture; chroma?: GpuTexture; references: number; bytes: number; release: () => void }
  constructor(sample: Pick<VideoSample, 'timestamp' | 'duration' | 'displayWidth' | 'displayHeight' | 'rotation' | 'flip'>, texture: GpuTexture, chroma: GpuTexture | undefined, bytes: number, release = () => { texture.destroy(); chroma?.destroy() }, shared?: VideoEditGpuFrame['resource']) {
    this.timestamp = sample.timestamp; this.duration = sample.duration
    this.displayWidth = sample.displayWidth; this.displayHeight = sample.displayHeight
    this.rotation = sample.rotation; this.flip = sample.flip
    this.resource = shared ?? { texture, chroma, bytes, release, references: 1 }
  }
  get texture(): GpuTexture { if (this.closed) throw new Error('预览帧已释放。'); return this.resource.texture }
  get chroma(): GpuTexture | undefined { if (this.closed) throw new Error('预览帧已释放。'); return this.resource.chroma }
  allocationSize(): number { return this.resource.bytes }
  clone(): VideoEditGpuFrame {
    if (this.closed) throw new Error('预览帧已释放。')
    this.resource.references++
    return new VideoEditGpuFrame(this, this.resource.texture, this.resource.chroma, this.resource.bytes, this.resource.release, this.resource)
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    if (--this.resource.references === 0) this.resource.release()
  }
}
