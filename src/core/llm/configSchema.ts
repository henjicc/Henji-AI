import { z } from 'zod'
import { modelStepCapabilitiesSchema, llmApiProtocolSchema } from '@henjicc/ai-sdk'

const agentModelReferenceSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
}).strict()

const capabilityCheckSchema = z.object({
  id: z.enum(['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel', 'image', 'video', 'audio']),
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

export const llmProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  primary: agentModelReferenceSchema,
  router: agentModelReferenceSchema.optional(),
  summarizer: agentModelReferenceSchema.optional(),
  fallback: agentModelReferenceSchema.optional(),
  observer: agentModelReferenceSchema.optional(),
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

const llmReasoningSchema = z.object({
  enabled: z.boolean(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
}).strict()

export const llmModelConfigSchema = z.object({
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
  reasoning: llmReasoningSchema.optional(),
  enabled: z.boolean(),
}).strict()
export type LlmModelConfig = z.infer<typeof llmModelConfigSchema>

