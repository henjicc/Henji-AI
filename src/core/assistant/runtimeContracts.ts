import { z } from 'zod'

import { agentBudgetConfigSchema, agentEventSchema, agentRunStateSchema } from './events'
import { modelStepCapabilitiesSchema } from '../llm/modelStep'
import { llmApiProtocolSchema } from '../llm/providerProtocol'
import { agentExternalContinuationSchema } from './externalWait'

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

const agentRuntimeReasoningSchema = z.object({
  enabled: z.boolean(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
}).strict()

export const agentRuntimeModelConfigSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  adapter: z.string().min(1),
  apiProtocol: llmApiProtocolSchema.optional(),
  baseUrl: z.string().optional(),
  capabilities: llmCapabilitiesSchema,
  pricing: z.object({
    currency: z.literal('USD'),
    inputPerMillionTokens: z.number().nonnegative(),
    outputPerMillionTokens: z.number().nonnegative(),
    cacheReadPerMillionTokens: z.number().nonnegative().optional(),
    cacheWritePerMillionTokens: z.number().nonnegative().optional(),
  }).strict().optional(),
  /** 供应商级思考配置；由渲染层随选定模型传入，运行时不自行猜测。 */
  reasoning: agentRuntimeReasoningSchema.optional(),
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
  externalContinuation: agentExternalContinuationSchema.optional(),
}).strict()
export type AgentStartRunRequest = z.infer<typeof agentStartRunRequestSchema>

export const agentRunControlRequestSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_SCHEMA_VERSION),
  runId: z.string().min(1),
}).strict()
export type AgentRunControlRequest = z.infer<typeof agentRunControlRequestSchema>

export const agentRunEventsRequestSchema = agentRunControlRequestSchema.extend({
  afterSequence: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(2_000).default(500),
}).strict()
export type AgentRunEventsRequest = z.infer<typeof agentRunEventsRequestSchema>

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

export const agentRunEventsPageSchema = z.object({
  runId: z.string().min(1),
  afterSequence: z.number().int().nonnegative(),
  events: z.array(agentEventSchema).max(2_000),
  oldestSequence: z.number().int().positive().nullable(),
  latestSequence: z.number().int().nonnegative(),
  coveredThroughSequence: z.number().int().nonnegative(),
  hasGap: z.boolean(),
  hasMore: z.boolean(),
  terminal: z.boolean(),
}).strict().superRefine((page, context) => {
  const eventIds = new Set<string>()
  let previousSequence = page.afterSequence
  for (const [index, event] of page.events.entries()) {
    if (event.runId !== page.runId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['events', index, 'runId'],
        message: '增量事件必须属于请求的 run',
      })
    }
    if (event.sequence <= previousSequence || event.sequence > page.latestSequence) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['events', index, 'sequence'],
        message: '增量事件必须严格递增且不超过 latestSequence',
      })
    }
    if (!page.hasGap && event.sequence !== previousSequence + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['events', index, 'sequence'],
        message: '无缺口页面的 sequence 必须连续',
      })
    }
    if (eventIds.has(event.eventId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['events', index, 'eventId'],
        message: '增量事件不能包含重复 eventId',
      })
    }
    eventIds.add(event.eventId)
    previousSequence = event.sequence
  }
  if (!page.hasGap && page.events[0] && page.events[0].sequence !== page.afterSequence + 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['events', 0, 'sequence'],
      message: '无缺口页面必须从 afterSequence 的下一条开始',
    })
  }
  if (page.hasGap && page.hasMore) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['hasMore'],
      message: '缺口页面不能同时声明可正常翻页',
    })
  }
})
export type AgentRunEventsPage = z.infer<typeof agentRunEventsPageSchema>
