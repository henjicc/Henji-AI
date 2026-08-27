import { z } from 'zod'

import { modelProviderErrorCategorySchema } from '../runtime/errors'
import { llmApiProtocolSchema } from './providerProtocol'

const jsonRecordSchema = z.record(z.string(), z.unknown())
const modelContentPartsSchema = z.array(jsonRecordSchema)

export const modelStepMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: z.string() }),
  z.object({ role: z.literal('user'), content: z.union([z.string(), modelContentPartsSchema]) }),
  z.object({ role: z.literal('assistant'), content: z.union([z.string(), modelContentPartsSchema]) }),
  z.object({ role: z.literal('tool'), content: modelContentPartsSchema }),
])
export type ModelStepMessage = z.infer<typeof modelStepMessageSchema>

export const modelStepCapabilitiesSchema = z.object({
  image: z.boolean(),
  video: z.boolean(),
  audio: z.boolean(),
  streaming: z.boolean(),
  toolCall: z.boolean(),
  parallelTools: z.boolean(),
  structuredOutputMode: z.enum(['none', 'json', 'schema']),
  reasoning: z.boolean(),
  sampling: z.boolean(),
  usage: z.boolean(),
})
export type ModelStepCapabilities = z.infer<typeof modelStepCapabilitiesSchema>

export const modelInputModalitySchema = z.enum(['image', 'video', 'audio'])
export type ModelInputModality = z.infer<typeof modelInputModalitySchema>

function detectPartModality(part: Record<string, unknown>): ModelInputModality | null {
  if (part.type === 'image' || part.type === 'image_url') return 'image'
  if (part.type === 'video' || part.type === 'video_url') return 'video'
  if (part.type === 'input_audio') return 'audio'
  const mediaType = typeof part.mediaType === 'string' ? part.mediaType : ''
  if (part.type === 'file' && mediaType.startsWith('image/')) return 'image'
  if (part.type === 'file' && mediaType.startsWith('video/')) return 'video'
  if (part.type === 'file' && mediaType.startsWith('audio/')) return 'audio'
  return null
}

/** 只记录输入包含的模态，不读取或复制媒体内容。 */
export function detectModelStepInputModalities(messages: ModelStepMessage[]): ModelInputModality[] {
  const modalities = new Set<ModelInputModality>()
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const part of message.content) {
      const modality = detectPartModality(part)
      if (modality) modalities.add(modality)
    }
  }
  return [...modalities]
}

export function assertModelStepInputCapabilities(input: Pick<ModelStepInput, 'messages' | 'capabilities'>): void {
  for (const modality of detectModelStepInputModalities(input.messages)) {
    if (!input.capabilities[modality]) {
      throw new Error(`[unsupported_input_modality] 当前模型未声明支持 ${modality} 输入`)
    }
  }
}

export const modelStepToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: jsonRecordSchema,
  strict: z.boolean().optional(),
})
export type ModelStepTool = z.infer<typeof modelStepToolSchema>

/**
 * Agent 模型步骤的调试元数据。它只描述上下文构建结果，不改变供应商请求语义；
 * 普通 LLM 调用可以省略该字段。
 */
export const modelStepTraceMetadataSchema = z.object({
  kind: z.enum(['router', 'primary', 'summarizer', 'fallback', 'observer', 'other']),
  inputModalities: z.array(modelInputModalitySchema).max(3).optional(),
  turn: z.number().int().positive().optional(),
  snapshotRevision: z.number().int().nonnegative().optional(),
  contextWindowBudget: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  estimatedTokens: z.number().int().nonnegative().optional(),
  compacted: z.boolean().optional(),
  beforeCompactionTokens: z.number().int().nonnegative().optional(),
  retainedLayers: z.array(z.string().min(1).max(100)).max(32).optional(),
  droppedLayers: z.array(z.string().min(1).max(100)).max(32).optional(),
  layerReports: z.array(z.object({
    id: z.string().min(1).max(100),
    included: z.boolean(),
    estimatedTokens: z.number().int().nonnegative(),
    truncated: z.boolean(),
    reason: z.string().max(500),
  }).strict()).max(32).optional(),
  activeToolNames: z.array(z.string().min(1).max(200)).max(64).optional(),
}).strict()
export type ModelStepTraceMetadata = z.infer<typeof modelStepTraceMetadataSchema>

export const modelStepInputSchema = z.object({
  requestId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiProtocol: llmApiProtocolSchema.optional(),
  adapter: z.string().optional(),
  baseUrl: z.string().optional(),
  system: z.string().min(1).max(64 * 1024).optional(),
  messages: z.array(modelStepMessageSchema).min(1),
  tools: z.array(modelStepToolSchema).optional(),
  output: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('text') }),
    z.object({
      mode: z.literal('object'),
      schema: jsonRecordSchema,
      name: z.string().optional(),
      description: z.string().optional(),
    }),
  ]).default({ mode: 'text' }),
  capabilities: modelStepCapabilitiesSchema,
  reasoning: z.object({
    enabled: z.boolean(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  }).optional(),
  settings: z.object({
    maxOutputTokens: z.number().int().positive().optional(),
    temperature: z.number().finite().optional(),
    topP: z.number().finite().optional(),
    maxRetries: z.number().int().min(0).max(5).optional(),
    timeoutMs: z.number().int().positive().optional(),
  }).optional(),
  providerOptions: z.record(z.string(), jsonRecordSchema).optional(),
  pricing: z.object({
    currency: z.literal('USD'),
    inputPerMillionTokens: z.number().nonnegative(),
    outputPerMillionTokens: z.number().nonnegative(),
    cacheReadPerMillionTokens: z.number().nonnegative().optional(),
    cacheWritePerMillionTokens: z.number().nonnegative().optional(),
  }).strict().optional(),
  trace: modelStepTraceMetadataSchema.optional(),
})
export type ModelStepInput = z.infer<typeof modelStepInputSchema>

export const modelStepToolCallSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  input: z.unknown(),
  dynamic: z.boolean(),
})
export type ModelStepToolCall = z.infer<typeof modelStepToolCallSchema>

/**
 * 与 AI SDK 6 的统一结束原因保持一致。未知结束原因在模型步骤边界即拒绝，
 * 避免新供应商值未经运行时安全裁决便进入工具执行链。
 */
export const modelStepFinishReasonSchema = z.enum([
  'stop',
  'length',
  'content-filter',
  'tool-calls',
  'error',
  'other',
])
export type ModelStepFinishReason = z.infer<typeof modelStepFinishReasonSchema>

export const modelStepUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  inputNoCacheTokens: z.number().int().nonnegative().nullable(),
  cacheReadTokens: z.number().int().nonnegative().nullable(),
  cacheWriteTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  textTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  knownCostUsd: z.number().nonnegative().nullable().optional(),
})
export type ModelStepUsage = z.infer<typeof modelStepUsageSchema>

export const modelStepResultSchema = z.object({
  requestId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  text: z.string(),
  reasoningText: z.string(),
  structuredOutput: z.unknown().nullable(),
  toolCalls: z.array(modelStepToolCallSchema),
  responseMessages: z.array(modelStepMessageSchema),
  finishReason: modelStepFinishReasonSchema,
  usage: modelStepUsageSchema,
  providerMetadataSummary: z.record(z.string(), z.array(z.string())),
  warnings: z.array(z.string()),
  elapsedMs: z.number().int().nonnegative(),
})
export type ModelStepResult = z.infer<typeof modelStepResultSchema>

export const modelStepEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TextDelta'), text: z.string() }),
  z.object({ type: z.literal('ReasoningDelta'), text: z.string() }),
  z.object({ type: z.literal('ToolCall'), toolCall: modelStepToolCallSchema }),
  z.object({
    type: z.literal('Retrying'),
    layer: z.literal('request'),
    attempt: z.number().int().positive(),
    delayMs: z.number().int().nonnegative(),
    category: modelProviderErrorCategorySchema,
    code: z.string().min(1),
  }),
])
export type ModelStepEvent = z.infer<typeof modelStepEventSchema>
