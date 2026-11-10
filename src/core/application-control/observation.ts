import { z } from 'zod'

import {
  applicationDataClassSchema,
  applicationMediaModalitySchema,
  applicationMediaRefSchema,
  applicationRefSchema,
  applicationStableIdSchema,
  applicationSurfaceIdSchema,
} from './identifiers'

const normalizedRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).strict().refine(
  (rect) => rect.x + rect.width <= 1 && rect.y + rect.height <= 1,
  { message: '遮罩区域必须位于目标 Surface 内' }
)

const applicationObservationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entity'), ref: applicationRefSchema }).strict(),
  z.object({ kind: z.literal('media'), ref: applicationMediaRefSchema }).strict(),
  z.object({ kind: z.literal('surface'), surfaceId: applicationSurfaceIdSchema }).strict(),
])

export const applicationObservationRequestSchema = z.object({
  requestId: z.string().min(1).max(200),
  target: applicationObservationTargetSchema,
  purpose: z.string().min(1).max(500),
  requestedModalities: z.array(applicationMediaModalitySchema).min(1).max(3),
  acceptedDataClasses: z.array(applicationDataClassSchema).min(1).max(4),
  maxBytes: z.number().int().positive().max(100 * 1024 * 1024),
  maxDurationMs: z.number().int().positive().max(60 * 60 * 1_000).optional(),
}).strict()

export const applicationObservationResultSchema = z.object({
  requestId: z.string().min(1).max(200),
  providerId: applicationStableIdSchema,
  target: applicationObservationTargetSchema,
  modality: applicationMediaModalitySchema,
  dataClass: applicationDataClassSchema,
  mediaRef: applicationMediaRefSchema.optional(),
  summary: z.string().min(1).max(8_000),
  masks: z.array(z.object({
    kind: z.enum(['region', 'field']),
    reason: z.string().min(1).max(300),
    region: normalizedRectSchema.optional(),
    fieldId: applicationStableIdSchema.optional(),
  }).strict().refine(
    (mask) => (mask.kind === 'region') === Boolean(mask.region),
    { message: '区域遮罩必须提供区域，字段遮罩不能提供区域' }
  )).max(128),
  capturedAt: z.string().datetime(),
}).strict()

