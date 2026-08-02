import { z } from 'zod'

import { APPLICATION_OBSERVATION_TARGETS } from './applicationSurfaces'

export const SURFACE_OBSERVATION_SCHEMA_VERSION = 'surface-observation/v1' as const

export const surfaceCaptureRectSchema = z.object({
  x: z.number().int().nonnegative().max(16_384),
  y: z.number().int().nonnegative().max(16_384),
  width: z.number().int().min(1).max(4_096),
  height: z.number().int().min(1).max(4_096),
}).strict()
export type SurfaceCaptureRect = z.infer<typeof surfaceCaptureRectSchema>

export const surfaceCaptureRequestSchema = z.object({
  schemaVersion: z.literal(SURFACE_OBSERVATION_SCHEMA_VERSION),
  // 'window' 表示整个应用窗口；其余为具体 Surface。两者都只截当前 webContents。
  target: z.enum(APPLICATION_OBSERVATION_TARGETS),
  rect: surfaceCaptureRectSchema,
  masks: z.array(surfaceCaptureRectSchema).max(128),
  maskPolicyId: z.enum(['surface.mask_declared_fields', 'surface.mask_sensitive_fields']),
}).strict().superRefine((value, context) => {
  for (const [index, mask] of value.masks.entries()) {
    if (mask.x + mask.width > value.rect.width || mask.y + mask.height > value.rect.height) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['masks', index],
        message: '遮罩必须位于截图区域内',
      })
    }
  }
})
export type SurfaceCaptureRequest = z.infer<typeof surfaceCaptureRequestSchema>

export const surfaceCaptureResultSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/png;base64,/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  maskedRegionCount: z.number().int().nonnegative(),
}).strict()
export type SurfaceCaptureResult = z.infer<typeof surfaceCaptureResultSchema>

export const surfaceObservationVerificationSchema = z.enum([
  'structured',
  'visual_pending_model',
  'visual_verified_by_primary',
  'visual_verified_by_observer',
  'unverified',
])
export type SurfaceObservationVerification = z.infer<typeof surfaceObservationVerificationSchema>

/**
 * 待模型读取的视觉观察结果的判定契约。
 *
 * Runner 用它决定哪些工具结果要转成真实媒体送进下一轮请求。以契约而不是工具名
 * 判定：任何观察能力只要返回 `verificationKind: 'visual_pending_model'` 加一个
 * 合法附件，像素就一定会进模型；反过来，产不出附件的能力也就不会让模型误以为
 * “已经看过画面”。
 */
export const pendingVisualObservationSchema = z.object({
  verificationKind: z.literal('visual_pending_model'),
  attachment: z.unknown(),
})

export function readPendingVisualObservation(output: unknown): unknown | null {
  const parsed = pendingVisualObservationSchema.safeParse(output)
  return parsed.success ? parsed.data.attachment : null
}
