import { z } from 'zod'

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
  streaming: z.boolean(),
  toolCall: z.boolean(),
  parallelTools: z.boolean(),
  structuredOutput: z.boolean(),
  reasoning: z.boolean(),
  sampling: z.boolean(),
  usage: z.boolean(),
})
export type ModelStepCapabilities = z.infer<typeof modelStepCapabilitiesSchema>

export const modelStepToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: jsonRecordSchema,
  strict: z.boolean().optional(),
})
export type ModelStepTool = z.infer<typeof modelStepToolSchema>

export const modelStepInputSchema = z.object({
  requestId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  adapter: z.string().optional(),
  baseUrl: z.string().optional(),
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
})
export type ModelStepInput = z.infer<typeof modelStepInputSchema>

export const modelStepToolCallSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  input: z.unknown(),
  dynamic: z.boolean(),
})
export type ModelStepToolCall = z.infer<typeof modelStepToolCallSchema>

export const modelStepUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  inputNoCacheTokens: z.number().int().nonnegative().nullable(),
  cacheReadTokens: z.number().int().nonnegative().nullable(),
  cacheWriteTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  textTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
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
  finishReason: z.string().min(1),
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
])
export type ModelStepEvent = z.infer<typeof modelStepEventSchema>
