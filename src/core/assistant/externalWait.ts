import { z } from 'zod'
import { applicationRefSchema } from '../application-control'
import { agentObservedEffectSchema } from './taskGraph'

export const GENERATION_STATUS_EVENT_VERSION = 'generation-status/v1' as const
export const AGENT_EXTERNAL_WAIT_VERSION = 'agent-external-wait/v2' as const

const scriptSourceLocationSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive(),
}).strict()

type ScriptSerializableValue = string | number | boolean | null
  | ScriptSerializableValue[]
  | { [key: string]: ScriptSerializableValue }

export const scriptSerializableValueSchema: z.ZodType<ScriptSerializableValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
  z.array(scriptSerializableValueSchema).max(512),
  z.record(z.string().max(200), scriptSerializableValueSchema),
]))

const scriptValueExpressionSchema: z.ZodType<Record<string, unknown>> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]) }).strict(),
  z.object({ kind: z.literal('array'), items: z.array(scriptValueExpressionSchema).max(128) }).strict(),
  z.object({
    kind: z.literal('object'),
    entries: z.array(z.object({ key: z.string().max(200), value: scriptValueExpressionSchema }).strict()).max(256),
  }).strict(),
  z.object({
    kind: z.literal('variable'), name: z.string().min(1).max(100),
    path: z.array(z.union([z.string().max(200), z.number().int().nonnegative()])).max(16),
  }).strict(),
  z.object({
    kind: z.literal('binary'), operator: z.string().min(1).max(4),
    left: scriptValueExpressionSchema, right: scriptValueExpressionSchema,
  }).strict(),
  z.object({
    kind: z.literal('template'),
    parts: z.array(z.union([z.string(), scriptValueExpressionSchema])).max(128),
  }).strict(),
  z.object({
    kind: z.literal('helper'), name: z.string().min(1).max(30),
    args: z.array(scriptValueExpressionSchema).max(16),
  }).strict(),
]))

const scriptInstructionSchema: z.ZodType<Record<string, unknown>> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('call'), stepId: z.string().min(1).max(100),
    api: z.enum(['action', 'entities.list', 'entities.read', 'entities.create', 'entities.update', 'entities.remove']),
    args: z.array(scriptValueExpressionSchema).max(8), location: scriptSourceLocationSchema,
  }).strict(),
  z.object({
    kind: z.literal('assert'), stepId: z.string().min(1).max(100),
    assertion: z.enum(['equal', 'exists', 'absent', 'matches']),
    args: z.array(scriptValueExpressionSchema).max(8), location: scriptSourceLocationSchema,
  }).strict(),
  z.object({
    kind: z.literal('branch'), stepId: z.string().min(1).max(100),
    condition: scriptValueExpressionSchema,
    whenTrue: z.array(scriptInstructionSchema).max(128),
    whenFalse: z.array(scriptInstructionSchema).max(128),
    location: scriptSourceLocationSchema,
  }).strict(),
  z.object({
    kind: z.literal('alias'), stepId: z.string().min(1).max(100),
    sourceStepId: z.string().min(1).max(100), recipeId: z.string().min(1).max(160),
    location: scriptSourceLocationSchema,
  }).strict(),
]))

const checkpointStepReceiptSchema = z.object({
  stepId: z.string().min(1).max(100), api: z.string().min(1).max(160),
  status: z.enum(['completed', 'waiting_external', 'failed']),
  location: scriptSourceLocationSchema,
  resultRefs: z.array(applicationRefSchema).max(64),
  effectCount: z.number().int().nonnegative(), summary: z.string().max(500),
}).strict()

/** 只含受控 IR、稳定引用和有限 JSON 值；不会保存模型文本或任意运行对象。 */
export const henjiScriptCheckpointSchema = z.object({
  version: z.literal('henji-script-checkpoint/v1'),
  scriptRunRef: z.string().min(1).max(200),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  continuationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  nextInstruction: z.number().int().nonnegative().max(128),
  remainingInstructions: z.array(scriptInstructionSchema).max(128),
  variables: z.array(z.object({
    name: z.string().min(1).max(100), value: scriptSerializableValueSchema,
  }).strict()).max(128),
  parents: z.array(z.object({ ref: applicationRefSchema, parent: applicationRefSchema }).strict()).max(128),
  resultRefs: z.array(applicationRefSchema).max(128),
  effects: z.array(agentObservedEffectSchema).max(512),
  steps: z.array(checkpointStepReceiptSchema).max(128),
  verificationState: z.object({ evidence: z.array(z.string().max(500)).max(128) }).strict(),
}).strict()
export type HenjiScriptCheckpoint = z.infer<typeof henjiScriptCheckpointSchema>

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
  continuation: henjiScriptCheckpointSchema.nullable().optional(),
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
  continuation: henjiScriptCheckpointSchema.nullable().optional(),
}).strict()
export type AgentExternalWaitRegister = z.infer<typeof agentExternalWaitRegisterSchema>

export const generationStatusReportRequestSchema = z.object({
  schemaVersion: z.literal('agent-runtime/v2'),
  event: generationStatusEventSchema,
}).strict()
export type GenerationStatusReportRequest = z.infer<typeof generationStatusReportRequestSchema>

export const agentCancelExternalWaitRequestSchema = z.object({
  schemaVersion: z.literal('agent-runtime/v2'),
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
  /** 源执行段已经由网关校验的真实写入回执；续接只能继承，禁止从文本重建。 */
  sourceEffects: z.array(agentObservedEffectSchema).max(512),
  scriptCheckpoint: henjiScriptCheckpointSchema.nullable().optional(),
}).strict()
export type AgentExternalContinuation = z.infer<typeof agentExternalContinuationSchema>
