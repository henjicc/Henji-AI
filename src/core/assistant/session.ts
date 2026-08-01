import { z } from 'zod'

import { AGENT_RUNTIME_SCHEMA_VERSION } from './runtimeContracts'
import { agentAttachmentsSchema } from './attachments'
import {
  modelStepFinishReasonSchema,
  modelStepMessageSchema,
  modelStepUsageSchema,
} from '../llm/modelStep'

export const AGENT_SESSION_ENTRY_SCHEMA_VERSION = 'agent-session-entry/v1' as const

export const agentSessionEntryKindSchema = z.enum([
  'user_message',
  'assistant_message',
  'model_message',
  'tool_result',
  'compaction',
  'queued_message',
  'external_wait',
  'run_reference',
])
export type AgentSessionEntryKind = z.infer<typeof agentSessionEntryKindSchema>

export const agentQueuedMessageModeSchema = z.enum(['clarification', 'current_task', 'after_task'])
export const agentQueuedMessageStatusSchema = z.enum(['accepted', 'consumed', 'cancelled', 'failed'])
export const agentQueuedMessagePayloadSchema = z.object({
  clientMessageId: z.string().min(1).max(200),
  content: z.string().min(1).max(32 * 1024),
  mode: agentQueuedMessageModeSchema,
  status: agentQueuedMessageStatusSchema,
  targetRunId: z.string().min(1),
  waitId: z.string().min(1).max(200).optional(),
  expiresAt: z.string().datetime().optional(),
  consumedByRunId: z.string().min(1).nullable().optional(),
  statusReason: z.string().max(500).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.mode === 'clarification' && !value.waitId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['waitId'],
      message: '回答当前问题必须携带 waitId',
    })
  }
  if (value.mode !== 'clarification' && value.waitId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['waitId'],
      message: '只有澄清回答可以携带 waitId',
    })
  }
})
export type AgentQueuedMessagePayload = z.infer<typeof agentQueuedMessagePayloadSchema>

export const agentEnqueueMessageRequestSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_SCHEMA_VERSION),
  threadId: z.string().min(1),
  runId: z.string().min(1),
  clientMessageId: z.string().min(1).max(200),
  content: z.string().trim().min(1).max(32 * 1024),
  mode: agentQueuedMessageModeSchema,
  waitId: z.string().min(1).max(200).optional(),
}).strict().superRefine((value, context) => {
  if (value.mode === 'clarification' && !value.waitId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['waitId'], message: '回答当前问题必须携带 waitId' })
  }
  if (value.mode !== 'clarification' && value.waitId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['waitId'], message: '只有澄清回答可以携带 waitId' })
  }
})
export type AgentEnqueueMessageRequest = z.infer<typeof agentEnqueueMessageRequestSchema>

export const agentCancelQueuedMessageRequestSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_SCHEMA_VERSION),
  threadId: z.string().min(1),
  runId: z.string().min(1),
  entryId: z.string().min(1),
}).strict()
export type AgentCancelQueuedMessageRequest = z.infer<typeof agentCancelQueuedMessageRequestSchema>

export const agentSessionEntryStatusSchema = z.enum(['active', 'superseded', 'tombstoned'])

export const agentSessionMessagePayloadSchema = z.object({
  content: z.string().max(256 * 1024),
  attachments: agentAttachmentsSchema.optional(),
  legacy: z.boolean().default(false),
  contextVisible: z.boolean().default(true),
}).strict()

export const agentSessionInternalMessagePayloadSchema = z.object({
  message: modelStepMessageSchema,
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  stepId: z.string().min(1).optional(),
  finishReason: modelStepFinishReasonSchema.optional(),
  usage: modelStepUsageSchema.optional(),
}).strict()
export type AgentSessionInternalMessagePayload = z.infer<
  typeof agentSessionInternalMessagePayloadSchema
>

export const agentSessionInternalAppendSchema = z.object({
  runId: z.string().min(1),
  threadId: z.string().min(1).max(200),
  turn: z.number().int().positive(),
  kind: z.enum(['model_message', 'tool_result']),
  payload: agentSessionInternalMessagePayloadSchema,
  idempotencyKey: z.string().min(1).max(500),
}).strict()
export type AgentSessionInternalAppend = z.infer<typeof agentSessionInternalAppendSchema>

const genericPayloadSchema = z.object({
  value: z.unknown(),
}).strict()

const agentSemanticSummaryV1Schema = z.object({
  version: z.literal('agent-semantic-summary/v1'),
  userIntent: z.string().min(1).max(2_000),
  userConstraints: z.array(z.string().min(1).max(1_000)).max(20),
  confirmedDecisions: z.array(z.string().min(1).max(1_000)).max(20),
  openQuestions: z.array(z.string().min(1).max(1_000)).max(20),
  contextNotes: z.array(z.string().min(1).max(1_000)).max(20),
}).strict()

export const agentSemanticSummaryV2Schema = z.object({
  version: z.literal('agent-semantic-summary/v2'),
  goal: z.string().min(1).max(2_000),
  constraints: z.array(z.string().min(1).max(1_000)).max(30),
  progress: z.object({
    done: z.array(z.string().min(1).max(1_000)).max(30),
    inProgress: z.array(z.string().min(1).max(1_000)).max(20),
    blocked: z.array(z.string().min(1).max(1_000)).max(20),
  }).strict(),
  keyDecisions: z.array(z.string().min(1).max(1_000)).max(30),
  nextSteps: z.array(z.string().min(1).max(1_000)).max(30),
  criticalContext: z.array(z.string().min(1).max(1_000)).max(30),
}).strict()

export const agentSemanticSummarySchema = z.union([
  agentSemanticSummaryV1Schema,
  agentSemanticSummaryV2Schema,
])
export type AgentSemanticSummary = z.infer<typeof agentSemanticSummaryV2Schema>

export const agentSessionCompactionPayloadSchema = z.object({
  summary: agentSemanticSummarySchema,
  coveredFromSequence: z.number().int().positive(),
  coveredThroughSequence: z.number().int().positive(),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  usage: modelStepUsageSchema,
  fallbackReason: z.string().max(500).nullable(),
}).strict()
export type AgentSessionCompactionPayload = z.infer<typeof agentSessionCompactionPayloadSchema>

export const agentSessionCompactionAppendSchema = z.object({
  runId: z.string().min(1),
  threadId: z.string().min(1).max(200),
  turn: z.number().int().positive(),
  payload: agentSessionCompactionPayloadSchema,
}).strict()
export type AgentSessionCompactionAppend = z.infer<typeof agentSessionCompactionAppendSchema>

export const agentSessionEntrySchema = z.object({
  schemaVersion: z.literal(AGENT_SESSION_ENTRY_SCHEMA_VERSION),
  entryId: z.string().min(1),
  threadId: z.string().min(1).max(200),
  sequence: z.number().int().positive(),
  runId: z.string().min(1).nullable(),
  turn: z.number().int().positive().nullable(),
  kind: agentSessionEntryKindSchema,
  payload: z.union([
    agentSessionMessagePayloadSchema,
    agentSessionInternalMessagePayloadSchema,
    agentSessionCompactionPayloadSchema,
    agentQueuedMessagePayloadSchema,
    genericPayloadSchema,
  ]),
  status: agentSessionEntryStatusSchema,
  parentEntryId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
}).strict()
export type AgentSessionEntry = z.infer<typeof agentSessionEntrySchema>

export const agentEnqueueMessageResultSchema = z.object({
  entry: agentSessionEntrySchema,
  deduplicated: z.boolean(),
}).strict()
export type AgentEnqueueMessageResult = z.infer<typeof agentEnqueueMessageResultSchema>

export const agentThreadSummarySchema = z.object({
  threadId: z.string().min(1).max(200),
  title: z.string(),
  messageCount: z.number().int().nonnegative(),
  lastRunId: z.string().min(1).nullable(),
  lastRunGoal: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict()
export type AgentThreadSummary = z.infer<typeof agentThreadSummarySchema>

export const agentListThreadsRequestSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_SCHEMA_VERSION),
  limit: z.number().int().min(1).max(100).default(30),
}).strict()
export type AgentListThreadsRequest = z.infer<typeof agentListThreadsRequestSchema>

export const agentDeleteThreadsRequestSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_SCHEMA_VERSION),
  requestId: z.string().min(1).max(200),
  threadIds: z.array(z.string().min(1).max(200)).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (new Set(value.threadIds).size !== value.threadIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['threadIds'],
      message: '待删除的对话不能重复',
    })
  }
})
export type AgentDeleteThreadsRequest = z.infer<typeof agentDeleteThreadsRequestSchema>

export const agentDeleteThreadsResultSchema = z.object({
  deletedThreadIds: z.array(z.string().min(1).max(200)).max(100),
  activeThreadIds: z.array(z.string().min(1).max(200)).max(100),
}).strict()
export type AgentDeleteThreadsResult = z.infer<typeof agentDeleteThreadsResultSchema>

export const agentTranscriptRequestSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_SCHEMA_VERSION),
  threadId: z.string().min(1).max(200),
  afterSequence: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(200).default(100),
}).strict()
export type AgentTranscriptRequest = z.infer<typeof agentTranscriptRequestSchema>

export const agentTranscriptPageSchema = z.object({
  threadId: z.string().min(1).max(200),
  afterSequence: z.number().int().nonnegative(),
  entries: z.array(agentSessionEntrySchema).max(200),
  headSequence: z.number().int().nonnegative(),
  coveredThroughSequence: z.number().int().nonnegative(),
  hasMore: z.boolean(),
}).strict().superRefine((page, context) => {
  let previous = page.afterSequence
  for (const [index, entry] of page.entries.entries()) {
    if (entry.threadId !== page.threadId || entry.sequence <= previous) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entries', index],
        message: '会话条目必须属于当前 thread 且 sequence 严格递增',
      })
    }
    previous = entry.sequence
  }
})
export type AgentTranscriptPage = z.infer<typeof agentTranscriptPageSchema>

export function getAgentSessionMessageContent(entry: AgentSessionEntry): string | null {
  if (entry.kind === 'queued_message') {
    const queued = agentQueuedMessagePayloadSchema.safeParse(entry.payload)
    return queued.success ? queued.data.content : null
  }
  if (entry.kind !== 'user_message' && entry.kind !== 'assistant_message') return null
  const parsed = agentSessionMessagePayloadSchema.safeParse(entry.payload)
  return parsed.success ? parsed.data.content : null
}

export function getAgentSessionMessageAttachments(entry: AgentSessionEntry) {
  if (entry.kind !== 'user_message' && entry.kind !== 'assistant_message') return []
  const parsed = agentSessionMessagePayloadSchema.safeParse(entry.payload)
  return parsed.success ? (parsed.data.attachments ?? []) : []
}
