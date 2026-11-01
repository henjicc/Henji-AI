import { z } from 'zod'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from './time'
import { codeMaterialAnimatedParameterValueSchema } from './codeMaterial/parameterValueSchema'
export const videoEditInterpolationSchema = z.enum(['linear', 'hold', 'ease', 'bezier'])
export const videoEditBezierSchema = z.tuple([z.number().finite().min(0).max(1), z.number().finite(), z.number().finite().min(0).max(1), z.number().finite()])


/** 与源曲线共用值和插值结构；此处时间为片段内整数帧。 */
export const videoEditKeyframeSchema = z.object({ value: codeMaterialAnimatedParameterValueSchema, interpolation: videoEditInterpolationSchema, bezier: videoEditBezierSchema.optional(), time: z.number().int().min(0).max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES), source: z.enum(['ducking', 'reframe', 'screen_attention']).optional(), reframeOrigin: z.object({ time: z.number().int().min(0).max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES), value: z.number().finite(), interpolation: z.enum(['linear', 'hold']) }).strict().optional(), duckingOrigin: z.object({ time: z.number().int().min(0).max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES), value: z.number().finite().min(0).max(2) }).strict().optional(), easeValues: z.tuple([codeMaterialAnimatedParameterValueSchema, codeMaterialAnimatedParameterValueSchema]).optional(), easeRange: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).refine(([a, b]) => b > a, '缓动区间终点须大于起点。').optional() }).strict()
export const videoEditKeyframesSchema = z.array(videoEditKeyframeSchema.overwrite(point => {
  // 来源标记只有与原始值一致时才有效，手工修改后的点归用户所有。
  const motion = point.source === 'screen_attention'
  const origin = point.reframeOrigin
  if (motion && (!origin || point.time !== origin.time || point.value !== origin.value || point.interpolation !== origin.interpolation || point.easeRange || point.bezier || point.easeValues)) {
    const { source: _source, reframeOrigin: _origin, ...manual } = point
    return manual
  }
  return point
})).superRefine((points, ctx) => {
  points.forEach((point, index) => {
    if (point.interpolation === 'bezier' && point.easeRange && !point.easeValues) ctx.addIssue({ code: 'custom', path: [index, 'easeValues'], message: '修剪后的贝塞尔曲线必须保留 easeValues 原值锚点。' })
    if (point.easeValues && (!['ease', 'bezier'].includes(point.interpolation) || !point.easeRange)) ctx.addIssue({ code: 'custom', path: [index, 'easeValues'], message: 'easeValues 只能用于带 easeRange 的缓动或贝塞尔曲线。' })
    if (point.easeValues && point.interpolation === 'ease' && point.bezier && (point.bezier[0] !== 1 / 3 || point.bezier[2] !== 2 / 3)) ctx.addIssue({ code: 'custom', path: [index, 'bezier'], message: '带原值锚点的 ease 必须使用线性时间控制点。' })
  })
  if (points.some((point, i) => i > 0 && point.time <= points[i - 1].time)) ctx.addIssue({ code: 'custom', message: '关键帧 time 必须按片段内帧升序排列，不能重复。' })
})
export type VideoEditKeyframe = z.infer<typeof videoEditKeyframeSchema>
export type VideoEditKeyframes = VideoEditKeyframe[]
