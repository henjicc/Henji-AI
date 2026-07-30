import { z } from 'zod'

import { agentRunStateSchema } from './events'
import { hostScopeRevisionsSchema } from './hostContracts'

export const AGENT_TURN_SNAPSHOT_VERSION = 'agent-turn-snapshot/v1' as const
export const AGENT_SAVE_POINT_VERSION = 'agent-save-point/v1' as const
export const AGENT_PROJECTION_VERSION = 'agent-context-message/v1' as const
export const AGENT_COMPACTION_VERSION = 'agent-semantic-summary/v1' as const

const modelReferenceSchema = z.object({
  role: z.enum(['primary', 'router', 'summarizer']),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiProtocol: z.string().min(1),
}).strict()

const toolReferenceSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
  schemaDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export const agentTurnSnapshotDraftSchema = z.object({
  version: z.literal(AGENT_TURN_SNAPSHOT_VERSION),
  runId: z.string().min(1),
  threadId: z.string().min(1),
  turn: z.number().int().positive(),
  projectionVersion: z.literal(AGENT_PROJECTION_VERSION),
  compactionVersion: z.literal(AGENT_COMPACTION_VERSION),
  models: z.array(modelReferenceSchema).length(3),
  tools: z.array(toolReferenceSchema).max(12),
  scopeRevisions: hostScopeRevisionsSchema,
  artifactRefs: z.array(z.string().min(1)).max(100),
  requestOptions: z.object({
    contextWindow: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    approvalMode: z.enum(['ask', 'assistant_decides', 'full_access']),
  }).strict(),
}).strict()
export type AgentTurnSnapshotDraft = z.infer<typeof agentTurnSnapshotDraftSchema>

export const agentTurnSnapshotSchema = agentTurnSnapshotDraftSchema.extend({
  sessionHeadSequence: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
}).strict()
export type AgentTurnSnapshot = z.infer<typeof agentTurnSnapshotSchema>

export const agentSavePointStageSchema = z.enum([
  'before_model',
  'before_tools',
  'after_tools',
  'waiting_user',
  'waiting_external',
  'settled',
])
export type AgentSavePointStage = z.infer<typeof agentSavePointStageSchema>

export const agentSavePointAppendSchema = z.object({
  version: z.literal(AGENT_SAVE_POINT_VERSION),
  stage: agentSavePointStageSchema.exclude(['settled']),
  snapshot: agentTurnSnapshotDraftSchema,
  state: agentRunStateSchema,
  idempotencyKey: z.string().min(1).max(300),
}).strict()
export type AgentSavePointAppend = z.infer<typeof agentSavePointAppendSchema>

export const agentSavePointSchema = z.object({
  version: z.literal(AGENT_SAVE_POINT_VERSION),
  stage: agentSavePointStageSchema,
  snapshot: agentTurnSnapshotSchema,
  stateSequence: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(300),
  createdAt: z.string().datetime(),
}).strict()
export type AgentSavePoint = z.infer<typeof agentSavePointSchema>

export const agentPendingChangeSchema = z.object({
  kind: z.enum(['message', 'model_config', 'tool_catalog', 'resource', 'host_context']),
  revision: z.number().int().nonnegative(),
  queuedAt: z.string().datetime(),
}).strict()
export type AgentPendingChange = z.infer<typeof agentPendingChangeSchema>
