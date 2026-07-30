import type { ProviderOptions } from '@ai-sdk/provider-utils'
import {
  Output,
  jsonSchema,
  streamText,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai'

import {
  modelStepInputSchema,
  modelStepMessageSchema,
  modelStepResultSchema,
  modelStepToolCallSchema,
  type ModelStepEvent,
  type ModelStepInput,
  type ModelStepMessage,
  type ModelStepResult,
  type ModelStepToolCall,
  type ModelStepUsage,
} from '../../../../../src/core/llm/modelStep'

export type ModelStepEmitter = (event: ModelStepEvent) => void

export interface ModelStepStreamTrace {
  startedAt: number
  firstChunkMs: number | null
  totalEventCount: number
  textDeltaCount: number
  reasoningDeltaCount: number
  toolCallCount: number
  textCharacters: number
  reasoningCharacters: number
}

function toAiMessages(messages: ModelStepMessage[]): ModelMessage[] {
  const validated = messages.map((message) => modelStepMessageSchema.parse(message))
  return validated as unknown as ModelMessage[]
}

function buildTools(input: ModelStepInput): ToolSet | undefined {
  if (!input.tools?.length) return undefined
  if (!input.capabilities.toolCall) throw new Error('[unsupported_capability] Model does not support tool calling')
  return Object.fromEntries(input.tools.map((definition) => [
    definition.name,
    tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema as Parameters<typeof jsonSchema>[0]),
      strict: definition.strict,
    }),
  ]))
}

export function buildModelStepProviderOptions(input: ModelStepInput): ProviderOptions | undefined {
  const options: ProviderOptions = { ...(input.providerOptions as ProviderOptions | undefined) }
  if (input.capabilities.reasoning && input.reasoning?.enabled && input.adapter?.trim().toLowerCase() !== 'deepseek') {
    options.openaiCompatible = {
      ...(options.openaiCompatible ?? {}),
      reasoningEffort: input.reasoning.effort,
    }
  }
  return Object.keys(options).length > 0 ? options : undefined
}

export function calculateModelStepKnownCostUsd(
  usage: Omit<ModelStepUsage, 'knownCostUsd'>,
  pricing: ModelStepInput['pricing']
): number | null {
  if (!pricing || usage.inputTokens === null || usage.outputTokens === null) return null
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  const inputNoCache = usage.inputNoCacheTokens
    ?? Math.max(0, usage.inputTokens - cacheRead - cacheWrite)
  const cost = (
    inputNoCache * pricing.inputPerMillionTokens
    + cacheRead * (pricing.cacheReadPerMillionTokens ?? pricing.inputPerMillionTokens)
    + cacheWrite * (pricing.cacheWritePerMillionTokens ?? pricing.inputPerMillionTokens)
    + usage.outputTokens * pricing.outputPerMillionTokens
  ) / 1_000_000
  return Number(cost.toFixed(12))
}

function normalizeUsage(
  usage: Awaited<ReturnType<typeof streamText>['usage']>,
  pricing: ModelStepInput['pricing']
): ModelStepUsage {
  const normalized = {
    inputTokens: usage.inputTokens ?? null,
    inputNoCacheTokens: usage.inputTokenDetails.noCacheTokens ?? null,
    cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? null,
    cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    textTokens: usage.outputTokenDetails.textTokens ?? null,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
  }
  return { ...normalized, knownCostUsd: calculateModelStepKnownCostUsd(normalized, pricing) }
}

function normalizeToolCall(call: {
  toolCallId: string
  toolName: string
  input: unknown
  dynamic?: boolean
}): ModelStepToolCall {
  return modelStepToolCallSchema.parse({
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    input: call.input,
    dynamic: call.dynamic ?? false,
  })
}

function toResponseMessages(value: unknown): ModelStepMessage[] {
  const serialized = JSON.parse(JSON.stringify(value)) as unknown
  if (!Array.isArray(serialized)) throw new Error('[invalid_response] SDK response messages are not an array')
  return serialized.map((message) => modelStepMessageSchema.parse(message))
}

function summarizeProviderMetadata(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const summary: Record<string, string[]> = {}
  for (const [provider, metadata] of Object.entries(value)) {
    summary[provider] = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? Object.keys(metadata)
      : []
  }
  return summary
}

function createOutput(input: ModelStepInput): ReturnType<typeof Output.text> | ReturnType<typeof Output.object> {
  if (input.output.mode === 'text') return Output.text()
  if (input.capabilities.structuredOutputMode === 'none') {
    throw new Error('[unsupported_capability] Model does not support structured output')
  }
  return Output.object({
    schema: jsonSchema(input.output.schema as Parameters<typeof jsonSchema>[0]),
    name: input.output.name,
    description: input.output.description,
  })
}

function isDeepSeekThinkingEnabled(input: ModelStepInput): boolean {
  return input.adapter?.trim().toLowerCase() === 'deepseek'
    && input.capabilities.reasoning
    && input.reasoning?.enabled === true
}

export async function executeModelStepWithModel(
  rawInput: ModelStepInput,
  model: LanguageModel,
  emit: ModelStepEmitter,
  signal: AbortSignal,
  streamTrace?: ModelStepStreamTrace
): Promise<ModelStepResult> {
  const input = modelStepInputSchema.parse(rawInput)
  const startedAt = Date.now()
  const settings = input.settings ?? {}
  const result = streamText({
    model,
    system: input.system,
    messages: toAiMessages(input.messages),
    allowSystemInMessages: false,
    tools: buildTools(input),
    output: createOutput(input),
    abortSignal: signal,
    timeout: settings.timeoutMs,
    // 请求重试统一由 runtime 的结构化策略负责，避免 SDK 与 Agent 双重重试。
    maxRetries: 0,
    maxOutputTokens: settings.maxOutputTokens,
    // DeepSeek 思考模式不支持采样参数；明确省略以避免“看似生效但实际被忽略”。
    temperature: input.capabilities.sampling && !isDeepSeekThinkingEnabled(input) ? settings.temperature : undefined,
    topP: input.capabilities.sampling && !isDeepSeekThinkingEnabled(input) ? settings.topP : undefined,
    providerOptions: buildModelStepProviderOptions(input),
  })

  for await (const part of result.fullStream) {
    if (streamTrace) {
      streamTrace.totalEventCount += 1
      if (streamTrace.firstChunkMs === null) streamTrace.firstChunkMs = Date.now() - streamTrace.startedAt
    }
    if (part.type === 'text-delta') emit({ type: 'TextDelta', text: part.text })
    else if (part.type === 'reasoning-delta') emit({ type: 'ReasoningDelta', text: part.text })
    else if (part.type === 'tool-call') emit({ type: 'ToolCall', toolCall: normalizeToolCall(part) })
    else if (part.type === 'error') throw part.error
    else if (part.type === 'abort') throw new Error('[task_cancelled] Model step aborted')
    if (streamTrace && part.type === 'text-delta') {
      streamTrace.textDeltaCount += 1
      streamTrace.textCharacters += part.text.length
    } else if (streamTrace && part.type === 'reasoning-delta') {
      streamTrace.reasoningDeltaCount += 1
      streamTrace.reasoningCharacters += part.text.length
    } else if (streamTrace && part.type === 'tool-call') {
      streamTrace.toolCallCount += 1
    }
  }

  const [text, reasoningText, structuredOutput, toolCalls, response, finishReason, usage, providerMetadata, warnings] = await Promise.all([
    result.text,
    result.reasoningText,
    result.output,
    result.toolCalls,
    result.response,
    result.finishReason,
    result.usage,
    result.providerMetadata,
    result.warnings,
  ])

  return modelStepResultSchema.parse({
    requestId: input.requestId,
    runId: input.runId,
    stepId: input.stepId,
    providerId: input.providerId,
    modelId: input.modelId,
    text,
    reasoningText: reasoningText ?? '',
    structuredOutput: input.output.mode === 'object' ? structuredOutput : null,
    toolCalls: toolCalls.map(normalizeToolCall),
    responseMessages: toResponseMessages(response.messages),
    finishReason,
    usage: normalizeUsage(usage, input.pricing),
    providerMetadataSummary: summarizeProviderMetadata(providerMetadata),
    warnings: (warnings ?? []).map((warning) => JSON.stringify(warning)),
    elapsedMs: Date.now() - startedAt,
  })
}
