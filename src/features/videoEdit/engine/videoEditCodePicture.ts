import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VIDEO_EDIT_PRECISE_FORMAT, type VideoEditGpuColorFormat } from './videoEditGpuFrame'

/** Texture belongs to the compositor's device, with premultiplied alpha. */
export class VideoEditCodePicture {
  /** 本帧含作者图层的零 alpha 发光；仅渲染成功后发布，嵌套合成沿输入传递。 */
  carriesLight = false
  /** True for `rgba16float` surfaces: effects and transitions on high-precision material keep its precision. */
  readonly highPrecision: boolean
  /**
   * The picture's size for placement, fit and anchors: its canvas size. Equal to the texture size except for a code
   * generator rendered at a reduced playback resolution (task 4.9), whose texture is smaller and sampled by UV, as a
   * downscaled video frame keeps its display size.
   */
  readonly displayWidth: number
  readonly displayHeight: number
  constructor(readonly texture: GpuTexture, readonly width: number, readonly height: number, readonly owner: GpuDevice, readonly textureFormat: VideoEditGpuColorFormat = 'rgba8unorm', readonly opaqueBackground = false, display?: { width: number; height: number }) {
    this.highPrecision = textureFormat === VIDEO_EDIT_PRECISE_FORMAT
    this.displayWidth = display?.width ?? width; this.displayHeight = display?.height ?? height
  }
}
