import { z } from 'zod'

export const GENERATION_STATUS_EVENT_VERSION = 'generation-status/v1' as const

export const generationTaskStatusSchema = z.enum([
  'pending', 'queued', 'generating', 'success', 'error', 'cancelled', 'timeout',
])
export type GenerationTaskStatus = z.infer<typeof generationTaskStatusSchema>

export function normalizeGenerationTaskStatus(value: string): GenerationTaskStatus | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'completed' || normalized === 'succeeded') return 'success'
  if (normalized === 'failed') return 'error'
  if (normalized === 'canceled') return 'cancelled'
  const parsed = generationTaskStatusSchema.safeParse(normalized)
  return parsed.success ? parsed.data : null
}

export function isGenerationTerminalStatus(status: string): boolean {
  const normalized = normalizeGenerationTaskStatus(status)
  return normalized !== null && ['success', 'error', 'cancelled', 'timeout'].includes(normalized)
}

export const generationStatusEventSchema = z.object({
  version: z.literal(GENERATION_STATUS_EVENT_VERSION),
  eventId: z.string().min(1),
  taskId: z.string().min(1).max(300),
  status: generationTaskStatusSchema,
  revision: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
  resultAvailable: z.boolean().default(false),
  errorCode: z.string().max(200).nullable().default(null),
  errorMessage: z.string().max(1_000).nullable().default(null),
}).strict()
export type GenerationStatusEvent = z.infer<typeof generationStatusEventSchema>

