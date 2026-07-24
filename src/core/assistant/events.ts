import { z } from 'zod'

import { hostScopeRevisionsSchema } from './hostContracts'
import { modelStepUsageSchema } from '../llm/modelStep'
import { agentWorkingSummarySchema } from './workingContext'

export const AGENT_EVENT_SCHEMA_VERSION = 'agent-event/v1' as const

export const agentRunStatusSchema = z.enum([
  'initializing',
  'running',
  'waiting_tool',
  'waiting_approval',
  'paused',
  'completed',
  'failed',
  'cancelled',
])
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>

export const serializedAgentErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  recovery: z.enum(['refresh_context', 'request_approval', 'wait', 'user_action', 'none']),
}).strict()
export type SerializedAgentError = z.infer<typeof serializedAgentErrorSchema>

export const agentToolCompletionKindSchema = z.enum(['observed', 'submitted', 'executed'])
export type AgentToolCompletionKind = z.infer<typeof agentToolCompletionKindSchema>

export const agentBudgetConfigSchema = z.object({
  maxTurns: z.number().int().min(1).max(100),
  maxToolCalls: z.number().int().min(0).max(500),
  maxDurationMs: z.number().int().min(1_000).max(24 * 60 * 60 * 1_000),
  maxInputTokens: z.number().int().min(1).max(10_000_000),
  maxOutputTokens: z.number().int().min(1).max(10_000_000),
  maxConsecutiveFailures: z.number().int().min(1).max(20),
  maxRepeatedToolCalls: z.number().int().min(1).max(20),
  maxNoProgressTurns: z.number().int().min(1).max(20),
  maxCostUsd: z.number().positive().optional(),
}).strict()
export type AgentBudgetConfig = z.infer<typeof agentBudgetConfigSchema>

export const agentBudgetUsageSchema = z.object({
  turns: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  knownCostUsd: z.number().nonnegative().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  noProgressTurns: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
}).strict()
export type AgentBudgetUsage = z.infer<typeof agentBudgetUsageSchema>

export const agentRunStateSchema = z.object({
  schemaVersion: z.literal(AGENT_EVENT_SCHEMA_VERSION),
  runId: z.string().min(1),
  threadId: z.string().min(1),
  status: agentRunStatusSchema,
  sequence: z.number().int().nonnegative(),
  turn: z.number().int().nonnegative(),
  currentStepId: z.string().min(1).nullable(),
  currentToolCallId: z.string().min(1).nullable(),
  waitingApprovalId: z.string().min(1).nullable(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  finalText: z.string().nullable(),
  error: serializedAgentErrorSchema.nullable(),
  budget: agentBudgetConfigSchema,
  usage: agentBudgetUsageSchema,
  lastScopeRevisions: hostScopeRevisionsSchema.nullable(),
  workingSummary: agentWorkingSummarySchema.optional(),
}).strict()
export type AgentRunState = z.infer<typeof agentRunStateSchema>

export const agentApprovalRequestSchema = z.object({
  approvalId: z.string().min(1),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  toolVersion: z.number().int().positive(),
  risk: z.enum(['R0', 'R1', 'R2', 'R3']),
  title: z.string().min(1),
  summary: z.string().min(1).max(2_000),
  argsDigest: z.string().min(1),
  previewDigest: z.string().min(1),
  targetIds: z.record(z.string(), z.string()),
  expectedRevisions: hostScopeRevisionsSchema.partial(),
  permission: z.string().min(1),
  scope: z.string().min(1),
  expiresAt: z.string().datetime(),
  reversible: z.boolean(),
}).strict()
export type AgentApprovalRequest = z.infer<typeof agentApprovalRequestSchema>

const eventBase = {
  schemaVersion: z.literal(AGENT_EVENT_SCHEMA_VERSION),
  eventId: z.string().min(1),
  sequence: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  runId: z.string().min(1),
}

const runStartedEventSchema = z.object({
  ...eventBase,
  type: z.literal('RunStarted'),
  threadId: z.string().min(1),
}).strict()

const runStateChangedEventSchema = z.object({
  ...eventBase,
  type: z.literal('RunStateChanged'),
  previous: agentRunStatusSchema,
  current: agentRunStatusSchema,
  reason: z.string().max(500).optional(),
}).strict()

const modelStartedEventSchema = z.object({
  ...eventBase,
  type: z.literal('ModelStarted'),
  stepId: z.string().min(1),
  turn: z.number().int().positive(),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
}).strict()

const modelDeltaEventSchema = z.object({
  ...eventBase,
  type: z.literal('ModelDelta'),
  stepId: z.string().min(1),
  text: z.string().max(16 * 1024),
}).strict()

const modelCompletedEventSchema = z.object({
  ...eventBase,
  type: z.literal('ModelCompleted'),
  stepId: z.string().min(1),
  finishReason: z.string().min(1),
  toolCallCount: z.number().int().nonnegative(),
  usage: modelStepUsageSchema,
}).strict()

const planUpdatedEventSchema = z.object({
  ...eventBase,
  type: z.literal('PlanUpdated'),
  intent: z.string().min(1).max(100),
  summary: z.string().min(1).max(500),
  toolDomains: z.array(z.string().min(1).max(100)).max(8),
}).strict()

const toolRequestedEventSchema = z.object({
  ...eventBase,
  type: z.literal('ToolRequested'),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  inputDigest: z.string().min(1),
  category: z.string().min(1).max(100).optional(),
  readOnly: z.boolean().optional(),
  idempotent: z.boolean().optional(),
}).strict()

const toolStartedEventSchema = z.object({
  ...eventBase,
  type: z.literal('ToolStarted'),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
}).strict()

const toolCompletedEventSchema = z.object({
  ...eventBase,
  type: z.literal('ToolCompleted'),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  summary: z.string().max(2_000),
  category: z.string().min(1).max(100).optional(),
  readOnly: z.boolean().optional(),
  idempotent: z.boolean().optional(),
  completionKind: agentToolCompletionKindSchema.optional(),
  artifactRef: z.string().min(1).optional(),
  resultReferences: z.record(z.string(), z.string().max(500)).refine(
    (references) => Object.keys(references).length <= 8,
    '结果引用最多 8 项'
  ).optional(),
}).strict()

const toolFailedEventSchema = z.object({
  ...eventBase,
  type: z.literal('ToolFailed'),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  error: serializedAgentErrorSchema,
  category: z.string().min(1).max(100).optional(),
  readOnly: z.boolean().optional(),
  idempotent: z.boolean().optional(),
}).strict()

const approvalRequiredEventSchema = z.object({
  ...eventBase,
  type: z.literal('ApprovalRequired'),
  toolCallId: z.string().min(1),
  approval: agentApprovalRequestSchema,
}).strict()

const approvalResolvedEventSchema = z.object({
  ...eventBase,
  type: z.literal('ApprovalResolved'),
  toolCallId: z.string().min(1),
  approvalId: z.string().min(1),
  decision: z.enum(['approved', 'rejected', 'expired']),
}).strict()

const contextUpdatedEventSchema = z.object({
  ...eventBase,
  type: z.literal('ContextUpdated'),
  turn: z.number().int().positive(),
  snapshotRevision: z.number().int().nonnegative(),
  activeToolNames: z.array(z.string().min(1)).max(12),
  estimatedTokens: z.number().int().nonnegative(),
}).strict()

const contextCompactedEventSchema = z.object({
  ...eventBase,
  type: z.literal('ContextCompacted'),
  beforeTokens: z.number().int().nonnegative(),
  afterTokens: z.number().int().nonnegative(),
  reason: z.string().min(1).max(500).optional(),
  retainedLayers: z.array(z.string().min(1).max(100)).max(16).optional(),
  droppedLayers: z.array(z.string().min(1).max(100)).max(16).optional(),
  summaryVersion: z.string().min(1).max(100).optional(),
}).strict()

const artifactOffloadedEventSchema = z.object({
  ...eventBase,
  type: z.literal('ArtifactOffloaded'),
  artifactRef: z.string().min(1),
  source: z.string().min(1),
  originalBytes: z.number().int().nonnegative(),
}).strict()

const verificationCompletedEventSchema = z.object({
  ...eventBase,
  type: z.literal('VerificationCompleted'),
  passed: z.boolean(),
  summary: z.string().min(1).max(500),
  evidence: z.array(z.string().min(1).max(500)).max(8),
}).strict()

const clarificationRequiredEventSchema = z.object({
  ...eventBase,
  type: z.literal('ClarificationRequired'),
  question: z.string().min(1).max(2_000),
  reason: z.string().min(1).max(500),
}).strict()

const runCompletedEventSchema = z.object({
  ...eventBase,
  type: z.literal('RunCompleted'),
  finalText: z.string(),
  usage: agentBudgetUsageSchema,
}).strict()

const runFailedEventSchema = z.object({
  ...eventBase,
  type: z.literal('RunFailed'),
  error: serializedAgentErrorSchema,
  usage: agentBudgetUsageSchema,
}).strict()

const runCancelledEventSchema = z.object({
  ...eventBase,
  type: z.literal('RunCancelled'),
  reason: z.string().min(1).max(500),
  usage: agentBudgetUsageSchema,
}).strict()

export const agentEventSchema = z.discriminatedUnion('type', [
  runStartedEventSchema,
  runStateChangedEventSchema,
  modelStartedEventSchema,
  modelDeltaEventSchema,
  modelCompletedEventSchema,
  planUpdatedEventSchema,
  toolRequestedEventSchema,
  toolStartedEventSchema,
  toolCompletedEventSchema,
  toolFailedEventSchema,
  approvalRequiredEventSchema,
  approvalResolvedEventSchema,
  contextUpdatedEventSchema,
  contextCompactedEventSchema,
  artifactOffloadedEventSchema,
  verificationCompletedEventSchema,
  clarificationRequiredEventSchema,
  runCompletedEventSchema,
  runFailedEventSchema,
  runCancelledEventSchema,
])
export type AgentEvent = z.infer<typeof agentEventSchema>
type AgentEventEnvelopeKey = 'schemaVersion' | 'eventId' | 'sequence' | 'occurredAt' | 'runId'
export type AgentEventInput = AgentEvent extends infer TEvent
  ? TEvent extends AgentEvent
    ? Omit<TEvent, AgentEventEnvelopeKey>
    : never
  : never
