import { z } from 'zod'

import { APPLICATION_OBSERVATION_TARGETS } from './applicationSurfaces'

export const SURFACE_OBSERVATION_SCHEMA_VERSION = 'surface-observation/v1' as const

const surfaceCaptureRectSchema = z.object({
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

