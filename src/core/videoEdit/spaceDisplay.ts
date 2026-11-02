import { z } from 'zod'
import type { VideoEditComposition } from './document'

/**
 * 节目监视器的三维显示方式（参照 Blender 视图的着色方式）：只影响看片，不改剪辑内容，导出始终按完整效果渲染。
 * - realtime 实时：材质、灯光、阴影、景深、运动模糊等全开；
 * - solid 实体：作者物体统一灰色明暗、不做后处理，卡片照常显示画面；
 * - wireframe 线框：作者物体只画结构线；
 * - render 渲染：路径追踪（全局光照、真实反射折射与景深），暂停时逐步收敛；不做运动模糊；
 * - auto 自动：播放跟不上时逐级简化（实时 → 实体 → 线框），暂停时回到实时。
 */
export const VIDEO_EDIT_SPACE_DISPLAYS = ['auto', 'realtime', 'solid', 'wireframe', 'render'] as const
export type VideoEditSpaceDisplay = typeof VIDEO_EDIT_SPACE_DISPLAYS[number]
/** 渲染器实际使用的显示方式（自动已解析）。 */
export type VideoEditSpaceRenderDisplay = Exclude<VideoEditSpaceDisplay, 'auto'>
export const VIDEO_EDIT_SPACE_RENDER_DISPLAYS = VIDEO_EDIT_SPACE_DISPLAYS.filter((mode): mode is VideoEditSpaceRenderDisplay => mode !== 'auto')
export const VIDEO_EDIT_SPACE_DISPLAY_LABELS: Record<VideoEditSpaceDisplay, string> = { auto: '自动', realtime: '实时', solid: '实体', wireframe: '线框', render: '渲染' }
export const videoEditSpaceDisplaySchema = z.object({ mode: z.enum(VIDEO_EDIT_SPACE_DISPLAYS) }).strict()
export type VideoEditSpaceDisplaySetting = z.infer<typeof videoEditSpaceDisplaySchema>
export const VIDEO_EDIT_DEFAULT_SPACE_DISPLAY: VideoEditSpaceDisplaySetting = { mode: 'auto' }
/** 自动简化的档位顺序。 */
export const VIDEO_EDIT_SPACE_DISPLAY_STEPS: readonly VideoEditSpaceRenderDisplay[] = ['realtime', 'solid', 'wireframe']

/** 这一序列有没有三维内容（序列相机或开了空间的片段）：没有时显示方式没有作用，界面也不提供。 */
export function videoEditCompositionHasSpace(composition: Pick<VideoEditComposition, 'spatialCamera' | 'clips'>): boolean {
  return Boolean(composition.spatialCamera) || composition.clips.some(clip => clip.spatial?.enabled)
}

/** 成片（导出、选帧、封面）按序列的三维渲染设置用哪种显示方式出画。 */
export function videoEditFinalSpaceDisplay(sequence: Pick<VideoEditComposition, 'spaceRender'>): VideoEditSpaceRenderDisplay {
  return sequence.spaceRender?.finalRenderer === 'pathTrace' ? 'render' : 'realtime'
}

/** 这一帧画面里有没有开了空间的片段：自动简化只按这样的帧判断跟不跟得上，纯二维段落的掉帧不算。 */
export function videoEditFrameHasSpace(composition: Pick<VideoEditComposition, 'clips'>, frame: number): boolean {
  return composition.clips.some(clip => clip.spatial?.enabled && clip.start <= frame && frame < clip.start + clip.duration)
}
