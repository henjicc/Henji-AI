import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VIDEO_EDIT_PRECISE_FORMAT, type VideoEditGpuColorFormat } from './videoEditGpuFrame'

/** Texture belongs to the compositor's device, with premultiplied alpha. */
export class VideoEditCodePicture {
  /** True for `rgba16float` surfaces: effects and transitions on high-precision material keep its precision. */
  readonly highPrecision: boolean
  constructor(readonly texture: GpuTexture, readonly width: number, readonly height: number, readonly owner: GpuDevice, readonly textureFormat: VideoEditGpuColorFormat = 'rgba8unorm', readonly opaqueBackground = false) {
    this.highPrecision = textureFormat === VIDEO_EDIT_PRECISE_FORMAT
  }
}
