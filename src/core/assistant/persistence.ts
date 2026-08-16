import { z } from 'zod'

import { agentRunStateSchema } from './events'
import { AGENT_RUNTIME_SCHEMA_VERSION, agentStartRunRequestSchema } from './runtimeContracts'

export const AGENT_CHECKPOINT_VERSION = 'agent-checkpoint/v3' as const

export const agentRunRecoveryStatusSchema = z.enum(['none', 'recovery_required', 'retried'])
export type AgentRunRecoveryStatus = z.infer<typeof agentRunRecoveryStatusSchema>

export const agentRunSummarySchema = z.object({
  runId: z.string().min(1),
  threadId: z.string().min(1),
  goal: z.string(),
  status: agentRunStateSchema.shape.status,
  recoveryStatus: agentRunRecoveryStatusSchema,
  parentRunId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  canRetry: z.boolean(),
}).strict()
export type AgentRunSummary = z.infer<typeof agentRunSummarySchema>

export const agentListRunsRequestSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_SCHEMA_VERSION),
  threadId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(30),
}).strict()
export type AgentListRunsRequest = z.infer<typeof agentListRunsRequestSchema>

export const agentRetryRunRequestSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_SCHEMA_VERSION),
  runId: z.string().min(1),
}).strict()
export type AgentRetryRunRequest = z.infer<typeof agentRetryRunRequestSchema>

export const storedAgentRunRequestSchema = agentStartRunRequestSchema.omit({
  userInstructions: true,
})
export type StoredAgentRunRequest = z.infer<typeof storedAgentRunRequestSchema>
