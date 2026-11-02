import type { VideoEditComposition } from '@/core/videoEdit/document'

/**
 * 外部三维渲染器（如 Blender Cycles）的接入约定，尚未实现。
 *
 * 浏览器里的路径追踪没有显卡硬件光追，超大场景、体积、毛发、复杂程序化材质留给外部渲染器。接入时：
 * - 场景包由统一三维渲染器的同一场景导出（glTF：作者物体、灯光、相机及其逐帧动画），卡片作为带画面序列帧的平面，
 *   画面取自宿主已画好的片段画面（与实时、路径追踪同一份），颜色按线性非预乘交付；
 * - 渲染出的帧按序列输出尺寸回到合成，在二维合成里替换对应空间组，与实时渲染器的组画面同一接入点；
 * - 序列设置 spaceRender.finalRenderer 届时增加 'external'（持久格式按规则升版本）。
 */
export interface VideoEditExternalSpaceRenderer {
  /** 是否可用（本机是否装了、版本是否支持），界面据此决定是否提供这个选项。 */
  describe(): Promise<{ available: boolean; name: string; version?: string; reason?: string }>
  /** 把一段帧范围的三维场景导出成外部渲染器能读的场景包，返回包所在目录。 */
  exportScene(composition: VideoEditComposition, range: { startFrame: number; endFrame: number }, signal: AbortSignal): Promise<{ directory: string }>
  /** 渲染场景包里的帧，逐帧交回线性预乘的 RGBA 半精度画面所在文件。 */
  render(scene: { directory: string }, frames: readonly number[], settings: { samples: number; width: number; height: number }, signal: AbortSignal,
    onFrame: (frame: number, file: string) => void): Promise<void>
}
