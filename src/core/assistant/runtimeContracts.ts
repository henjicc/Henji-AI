import { z } from 'zod'

import { agentBudgetConfigSchema, agentEventSchema, agentRunStateSchema } from './events'
import { modelStepCapabilitiesSchema } from '../llm/modelStep'

export const AGENT_RUNTIME_SCHEMA_VERSION = 'agent-runtime/v1' as const
export const agentApprovalModeSchema = z.enum(['ask', 'assistant_decides', 'full_access'])
export type AgentApprovalMode = z.infer<typeof agentApprovalModeSchema>

const agentModelReferenceSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
}).strict()

const capabilityCheckSchema = z.object({
  id: z.enum(['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel']),
  status: z.enum(['passed', 'failed', 'skipped']),
  latencyMs: z.number().int().nonnegative(),
  errorCode: z.string().optional(),
}).strict()

const capabilityVerificationSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  adapterVersion: z.string(),
  verifiedAt: z.string().datetime(),
  checks: z.array(capabilityCheckSchema),
  totalLatencyMs: z.number().int().nonnegative(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    reasoningTokens: z.number().int().nonnegative().nullable(),
    cacheReadTokens: z.number().int().nonnegative().nullable(),
    cacheWriteTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
  }).strict(),
  cost: z.discriminatedUnion('status', [
    z.object({ status: z.literal('unknown') }).strict(),
    z.object({ status: z.literal('known'), amount: z.number().nonnegative(), currency: z.string().min(1) }).strict(),
  ]),
}).strict()

export const agentRuntimeProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  primary: agentModelReferenceSchema,
  router: agentModelReferenceSchema.optional(),
  summarizer: agentModelReferenceSchema.optional(),
  fallback: agentModelReferenceSchema.optional(),
  settings: z.object({
    timeoutMs: z.number().int().positive(),
    maxRetries: z.number().int().min(0).max(5),
    maxOutputTokens: z.number().int().positive(),
    contextWindowBudget: z.number().int().positive(),
    temperature: z.number().finite().optional(),
  }).strict(),
  verifications: z.array(capabilityVerificationSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict()

const llmCapabilitiesSchema = modelStepCapabilitiesSchema.extend({
  text: z.boolean(),
  image: z.boolean(),
  video: z.boolean(),
  audio: z.boolean(),
  jsonOutput: z.boolean(),
  contextWindow: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
}).strict()

export const agentRuntimeModelConfigSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  adapter: z.string().min(1),
  baseUrl: z.string().optional(),
  capabilities: llmCapabilitiesSchema,
  enabled: z.boolean(),
}).strict()
export type AgentRuntimeModelConfig = z.infer<typeof agentRuntimeModelConfigSchema>

export const agentStartRunRequestSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_SCHEMA_VERSION),
  threadId: z.string().min(1).max(200),
  goal: z.string().min(1).max(32 * 1024),
  userInstructions: z.string().max(4_000).optional(),
  profile: agentRuntimeProfileSchema,
  models: z.array(agentRuntimeModelConfigSchema).min(1).max(200),
  approvalMode: agentApprovalModeSchema.default('assistant_decides'),
  budget: agentBudgetConfigSchema.partial().optional(),
}).strict()
export type AgentStartRunRequest = z.infer<typeof agentStartRunRequestSchema>

export const agentRunControlRequestSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_SCHEMA_VERSION),
  runId: z.string().min(1),
}).strict()
export type AgentRunControlRequest = z.infer<typeof agentRunControlRequestSchema>

export const agentCancelRunRequestSchema = agentRunControlRequestSchema.extend({
  reason: z.string().min(1).max(500).default('用户取消'),
}).strict()
export type AgentCancelRunRequest = z.infer<typeof agentCancelRunRequestSchema>

export const agentApprovalResponseSchema = agentRunControlRequestSchema.extend({
  approvalId: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
}).strict()
export type AgentApprovalResponse = z.infer<typeof agentApprovalResponseSchema>

export const agentRuntimeEventPayloadSchema = z.object({
  runId: z.string().min(1),
  event: agentEventSchema,
}).strict()
export type AgentRuntimeEventPayload = z.infer<typeof agentRuntimeEventPayloadSchema>

export const agentStartRunResultSchema = z.object({
  runId: z.string().min(1),
  state: agentRunStateSchema,
}).strict()
export type AgentStartRunResult = z.infer<typeof agentStartRunResultSchema>

export const agentRunSnapshotSchema = z.object({
  state: agentRunStateSchema,
  events: z.array(agentEventSchema).max(2_000),
}).strict()
export type AgentRunSnapshot = z.infer<typeof agentRunSnapshotSchema>
