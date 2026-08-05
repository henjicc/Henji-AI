import { z } from 'zod'

import { hostScopeRevisionsSchema } from './hostContracts'
import { AGENT_ACTIVE_TOOL_LIMIT } from './toolBudget'
import { modelStepUsageSchema } from '../llm/modelStep'
import { modelProviderErrorCategorySchema } from '../llm/providerProtocol'
import { agentWorkingSummarySchema } from './workingContext'
import { agentTaskFacetStatusSchema, agentTaskGraphSchema } from './taskGraph'
import { agentFacetProgressKindSchema } from './progress'

export const AGENT_EVENT_SCHEMA_VERSION = 'agent-event/v1' as const

export const agentRunStatusSchema = z.enum([
  'initializing',
  'running',
  'waiting_tool',
  'waiting_approval',
  'waiting_user',
  'waiting_external',
  'paused',
  'completed',
  'budget_exhausted',
  'failed',
  'cancelled',
])
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>

export const agentRunPhaseSchema = z.enum([
  'planning',
  'discovering',
  'preparing',
  'awaiting_approval',
  'executing',
  'verifying',
  'waiting_external',
  'continuing',
  'completed',
  'blocked',
])
export type AgentRunPhase = z.infer<typeof agentRunPhaseSchema>

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
  softMaxTurns: z.number().int().min(1).max(10_000).nullable().default(null),
  maxTurns: z.number().int().min(1).max(10_000).nullable(),
  softMaxToolCalls: z.number().int().min(0).max(100_000).nullable().default(null),
  maxToolCalls: z.number().int().min(0).max(100_000).nullable(),
  softMaxWriteToolCalls: z.number().int().min(0).max(100_000).nullable().default(null),
  maxWriteToolCalls: z.number().int().min(0).max(100_000).nullable().default(null),
  maxDurationMs: z.number().int().min(1_000).max(7 * 24 * 60 * 60 * 1_000).nullable(),
  maxInputTokens: z.number().int().min(1).max(10_000_000).nullable(),
  maxOutputTokens: z.number().int().min(1).max(10_000_000).nullable(),
  maxConsecutiveFailures: z.number().int().min(1).max(10_000).nullable(),
  maxRepeatedToolCalls: z.number().int().min(1).max(10_000).nullable(),
  maxNoProgressTurns: z.number().int().min(1).max(10_000).nullable(),
  softMaxCostUsd: z.number().positive().nullable().default(null),
  maxCostUsd: z.number().positive().nullable().optional(),
}).strict()
export type AgentBudgetConfig = z.infer<typeof agentBudgetConfigSchema>

export const agentBudgetUsageSchema = z.object({
  turns: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  writeToolCalls: z.number().int().nonnegative().default(0),
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
  waitingClarificationId: z.string().min(1).nullable().optional(),
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

export const agentApprovalTargetIdsSchema = z.record(
  z.string().min(1).max(100),
  z.string().max(500)
).refine((targets) => Object.keys(targets).length <= 32, '审批目标最多 32 项')
const agentApprovalDataClassSchema = z.enum(['C0', 'C1', 'C2', 'C3'])

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
  targetIds: agentApprovalTargetIdsSchema,
  dataClasses: z.array(agentApprovalDataClassSchema).min(1).max(4).default(['C0']),
  destination: z.string().max(500).optional(),
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
  goal: z.string().min(1).max(32 * 1024).optional(),
  attachmentRefs: z.array(z.string().regex(/^asset:[^\s]+$/)).max(8).optional(),
}).strict()

const runStateChangedEventSchema = z.object({
  ...eventBase,
  type: z.literal('RunStateChanged'),
  previous: agentRunStatusSchema,
  current: agentRunStatusSchema,
  reason: z.string().max(500).optional(),
}).strict()

const runPhaseChangedEventSchema = z.object({
  ...eventBase,
  type: z.literal('RunPhaseChanged'),
  phase: agentRunPhaseSchema,
  previous: agentRunPhaseSchema.nullable(),
  detail: z.string().min(1).max(500).optional(),
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
  /** Provider 原始片段会在分配 sequence 前合并；这里始终是可持久、可重放的有界文本块。 */
  text: z.string().max(16 * 1024),
  /**
   * 正文还是思维链。历史事件没有这个字段，默认按正文重放。
   * 两条流必须分开落库：合并后无法再拆开，界面也就没法把"在想什么"和"在说什么"分区展示。
   */
  channel: z.enum(['text', 'reasoning']).optional(),
}).strict()

const modelRetryingEventSchema = z.object({
  ...eventBase,
  type: z.literal('ModelRetrying'),
  stepId: z.string().min(1),
  layer: z.enum(['request', 'semantic']),
  attempt: z.number().int().positive(),
  delayMs: z.number().int().nonnegative(),
  category: modelProviderErrorCategorySchema,
  code: z.string().min(1).max(200),
}).strict()

const modelCompletedEventSchema = z.object({
  ...eventBase,
  type: z.literal('ModelCompleted'),
  stepId: z.string().min(1),
  finishReason: z.string().min(1),
  toolCallCount: z.number().int().nonnegative(),
  /** 仅保存模型实际产生、可向用户展示的文本；不包含 reasoning。 */
  displayText: z.string().min(1).max(2_000).optional(),
  usage: modelStepUsageSchema,
}).strict()

const planUpdatedEventSchema = z.object({
  ...eventBase,
  type: z.literal('PlanUpdated'),
  intent: z.string().min(1).max(100),
  summary: z.string().min(1).max(500),
  toolDomains: z.array(z.string().min(1).max(100)).max(8),
  taskGraph: agentTaskGraphSchema.optional(),
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

const facetProgressedEventSchema = z.object({
  ...eventBase,
  type: z.literal('FacetProgressed'),
  facetId: z.string().min(1).max(64),
  status: agentTaskFacetStatusSchema,
  progressKind: agentFacetProgressKindSchema,
  summary: z.string().min(1).max(1_000),
  evidence: z.array(z.string().min(1).max(500)).max(12),
  executionFingerprint: z.string().min(1).max(200).optional(),
  blocker: z.string().min(1).max(1_000).optional(),
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
  activeToolNames: z.array(z.string().min(1)).max(AGENT_ACTIVE_TOOL_LIMIT),
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

const budgetSoftLimitReachedEventSchema = z.object({
  ...eventBase,
  type: z.literal('BudgetSoftLimitReached'),
  code: z.enum([
    'SOFT_MAX_TURNS', 'SOFT_MAX_TOOL_CALLS', 'SOFT_MAX_WRITE_TOOL_CALLS', 'SOFT_MAX_COST',
    'SOFT_CONSECUTIVE_FAILURES', 'SOFT_REPEATED_TOOL_CALLS', 'SOFT_NO_PROGRESS_TURNS',
  ]),
  usage: agentBudgetUsageSchema,
}).strict()

const budgetHardLimitReachedEventSchema = z.object({
  ...eventBase,
  type: z.literal('BudgetHardLimitReached'),
  code: z.string().min(1).max(100),
  usage: agentBudgetUsageSchema,
}).strict()

const runContinuationStartedEventSchema = z.object({
  ...eventBase,
  type: z.literal('RunContinuationStarted'),
  sourceRunId: z.string().min(1),
  segment: z.number().int().min(2).max(3),
  maxSegments: z.literal(3),
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
  waitId: z.string().min(1).max(200).optional(),
  question: z.string().min(1).max(2_000),
  reason: z.string().min(1).max(500),
}).strict()

const externalWaitRegisteredEventSchema = z.object({
  ...eventBase,
  type: z.literal('ExternalWaitRegistered'),
  waitId: z.string().min(1),
  taskId: z.string().min(1),
  expiresAt: z.string().datetime(),
}).strict()

const externalWaitResumedEventSchema = z.object({
  ...eventBase,
  type: z.literal('ExternalWaitResumed'),
  waitId: z.string().min(1),
  taskId: z.string().min(1),
  status: z.enum(['success', 'error', 'cancelled', 'timeout']),
  sourceRunId: z.string().min(1),
  sourceTotalTokens: z.number().int().nonnegative(),
  sourceKnownCostUsd: z.number().nonnegative().nullable(),
}).strict()

const savePointCreatedEventSchema = z.object({
  ...eventBase,
  type: z.literal('SavePointCreated'),
  turn: z.number().int().positive(),
  stage: z.enum([
    'before_model', 'before_tools', 'after_tools',
    'waiting_user', 'waiting_external', 'settled',
  ]),
  sessionHeadSequence: z.number().int().nonnegative(),
  snapshotVersion: z.string().min(1).max(100),
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
  runPhaseChangedEventSchema,
  modelStartedEventSchema,
  modelDeltaEventSchema,
  modelRetryingEventSchema,
  modelCompletedEventSchema,
  planUpdatedEventSchema,
  toolRequestedEventSchema,
  toolStartedEventSchema,
  toolCompletedEventSchema,
  toolFailedEventSchema,
  facetProgressedEventSchema,
  approvalRequiredEventSchema,
  approvalResolvedEventSchema,
  contextUpdatedEventSchema,
  contextCompactedEventSchema,
  budgetSoftLimitReachedEventSchema,
  budgetHardLimitReachedEventSchema,
  runContinuationStartedEventSchema,
  artifactOffloadedEventSchema,
  verificationCompletedEventSchema,
  clarificationRequiredEventSchema,
  externalWaitRegisteredEventSchema,
  externalWaitResumedEventSchema,
  savePointCreatedEventSchema,
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
