import { z } from 'zod'

import { AGENT_RUNTIME_SCHEMA_VERSION } from './runtimeContracts'

export const AGENT_SESSION_ENTRY_SCHEMA_VERSION = 'agent-session-entry/v1' as const

export const agentSessionEntryKindSchema = z.enum([
  'user_message',
  'assistant_message',
  'compaction',
  'queued_message',
  'external_wait',
  'run_reference',
])
export type AgentSessionEntryKind = z.infer<typeof agentSessionEntryKindSchema>

export const agentSessionEntryStatusSchema = z.enum(['active', 'superseded', 'tombstoned'])

const messagePayloadSchema = z.object({
  content: z.string().max(256 * 1024),
  legacy: z.boolean().default(false),
}).strict()

const genericPayloadSchema = z.object({
  value: z.unknown(),
}).strict()

export const agentSessionEntrySchema = z.object({
  schemaVersion: z.literal(AGENT_SESSION_ENTRY_SCHEMA_VERSION),
  entryId: z.string().min(1),
  threadId: z.string().min(1).max(200),
  sequence: z.number().int().positive(),
  runId: z.string().min(1).nullable(),
  turn: z.number().int().positive().nullable(),
  kind: agentSessionEntryKindSchema,
  payload: z.union([messagePayloadSchema, genericPayloadSchema]),
  status: agentSessionEntryStatusSchema,
  parentEntryId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
}).strict()
export type AgentSessionEntry = z.infer<typeof agentSessionEntrySchema>

export const agentThreadSummarySchema = z.object({
  threadId: z.string().min(1).max(200),
  title: z.string(),
  headSequence: z.number().int().nonnegative(),
  lastRunId: z.string().min(1).nullable(),
  lastRunGoal: z.string(),
  lastMessagePreview: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict()
export type AgentThreadSummary = z.infer<typeof agentThreadSummarySchema>

export const agentListThreadsRequestSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_SCHEMA_VERSION),
  limit: z.number().int().min(1).max(100).default(30),
}).strict()
export type AgentListThreadsRequest = z.infer<typeof agentListThreadsRequestSchema>

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
  if (entry.kind !== 'user_message' && entry.kind !== 'assistant_message') return null
  const parsed = messagePayloadSchema.safeParse(entry.payload)
  return parsed.success ? parsed.data.content : null
}
