import { z } from 'zod'

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

