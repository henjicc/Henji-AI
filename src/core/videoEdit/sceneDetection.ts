import { z } from 'zod'

export const sceneSensitivitySchema = z.number().finite().min(0).max(100)
export const sceneCutsSchema = z.array(z.number().finite().nonnegative()).max(499)
export const sceneDetectionRequestSchema = z.object({
  requestId: z.string().min(1).max(100), source: z.string().min(1).max(32768),
  startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().positive().max(86400),
  sensitivity: sceneSensitivitySchema,
}).strict().refine(value => value.endSeconds > value.startSeconds && value.endSeconds - value.startSeconds <= 1800, '检测源范围须在 30 分钟以内。')
export const sceneDetectionResultSchema = z.object({ cutsSeconds: sceneCutsSchema, contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export const sceneApplyOptionsSchema = z.object({ split: z.boolean(), markers: z.boolean(), subclips: z.boolean() }).strict().refine(value => value.split || value.markers || value.subclips, '请至少选择一种应用方式。')
export type SceneDetectionRequest = z.infer<typeof sceneDetectionRequestSchema>
export type SceneDetectionResult = z.infer<typeof sceneDetectionResultSchema>
export type SceneApplyOptions = z.infer<typeof sceneApplyOptionsSchema>
/** Intention scale: zero keeps only strong cuts, 100 includes subtle cuts. */
export function sceneDetectionThreshold(sensitivity: number): number { return 25 - sceneSensitivitySchema.parse(sensitivity) * .24 }
