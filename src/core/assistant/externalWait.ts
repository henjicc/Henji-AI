import { z } from 'zod'

export const GENERATION_STATUS_EVENT_VERSION = 'generation-status/v1' as const
export const AGENT_EXTERNAL_WAIT_VERSION = 'agent-external-wait/v1' as const

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

export const agentExternalWaitStatusSchema = z.enum([
  'active', 'claimed', 'consumed', 'cancelled', 'timed_out', 'failed',
])

export const agentExternalWaitRecordSchema = z.object({
  version: z.literal(AGENT_EXTERNAL_WAIT_VERSION),
  waitId: z.string().min(1),
  threadId: z.string().min(1),
  sourceRunId: z.string().min(1),
  taskId: z.string().min(1),
  targetStatuses: z.array(generationTaskStatusSchema).min(1).max(4),
  status: agentExternalWaitStatusSchema,
  resumePolicy: z.literal('linked_child_once'),
  savePointSequence: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  lastObservedStatus: generationTaskStatusSchema.nullable(),
  lastEventId: z.string().min(1).nullable(),
  claimedAt: z.string().datetime().nullable(),
  consumedAt: z.string().datetime().nullable(),
  resumedRunId: z.string().min(1).nullable(),
  error: z.string().max(1_000).nullable(),
}).strict()
export type AgentExternalWaitRecord = z.infer<typeof agentExternalWaitRecordSchema>

export const agentExternalWaitRegisterSchema = z.object({
  version: z.literal(AGENT_EXTERNAL_WAIT_VERSION),
  waitId: z.string().min(1),
  threadId: z.string().min(1),
  sourceRunId: z.string().min(1),
  taskId: z.string().min(1),
  targetStatuses: z.array(generationTaskStatusSchema).min(1).max(4),
  timeoutMs: z.number().int().min(1_000).max(24 * 60 * 60 * 1_000),
  savePointSequence: z.number().int().nonnegative(),
  resumePolicy: z.literal('linked_child_once'),
}).strict()
export type AgentExternalWaitRegister = z.infer<typeof agentExternalWaitRegisterSchema>

export const generationStatusReportRequestSchema = z.object({
  schemaVersion: z.literal('agent-runtime/v1'),
  event: generationStatusEventSchema,
}).strict()
export type GenerationStatusReportRequest = z.infer<typeof generationStatusReportRequestSchema>

export const agentCancelExternalWaitRequestSchema = z.object({
  schemaVersion: z.literal('agent-runtime/v1'),
  waitId: z.string().min(1),
  cancelGeneration: z.boolean(),
}).strict()
export type AgentCancelExternalWaitRequest = z.infer<typeof agentCancelExternalWaitRequestSchema>

export const agentExternalContinuationSchema = z.object({
  waitId: z.string().min(1),
  sourceRunId: z.string().min(1),
  taskId: z.string().min(1),
  observedStatus: generationTaskStatusSchema,
  sourceTotalTokens: z.number().int().nonnegative(),
  sourceKnownCostUsd: z.number().nonnegative().nullable(),
}).strict()
export type AgentExternalContinuation = z.infer<typeof agentExternalContinuationSchema>
