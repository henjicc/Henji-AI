import { z } from 'zod'
import { videoEditEffectSchema, videoEditEffectMedia } from './compositing'

/** Shared by the local effect library and the preset exchange file. */
export const videoEditEffectPresetNameSchema = z.string().trim().min(1, '请填写预设名称。').max(200, '预设名称最多 200 字。')
export const videoEditEffectPresetSchema = z.object({
  id: z.string().min(1).max(100), name: videoEditEffectPresetNameSchema, media: z.enum(['video', 'audio']),
  effects: z.array(videoEditEffectSchema).min(1),
}).strict().superRefine((preset, context) => {
  if (preset.effects.some(effect => !effect.builtin || videoEditEffectMedia(effect) !== preset.media || effect.mask?.regionId === 'tracker' || effect.mask?.regionId === 'shapes' && effect.mask.shapes.some(shape => shape.follow))) context.addIssue({ code: 'custom', message: '预设只保存同媒介的内置效果，不能保存原片段的跟踪绑定；代码滤镜请保存为代码素材。' })
})
export type VideoEditEffectPreset = z.infer<typeof videoEditEffectPresetSchema>
