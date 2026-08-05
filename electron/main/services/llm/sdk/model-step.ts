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
  assertModelStepInputCapabilities,
  detectModelStepInputModalities,
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
import { normalizeProviderToolSchema } from './tool-schema'

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

function contentParts(message: ModelStepMessage): Array<Record<string, unknown>> {
  return Array.isArray(message.content) ? message.content : []
}

function toolCallIds(message: ModelStepMessage): string[] {
  if (message.role !== 'assistant') return []
  return contentParts(message).flatMap((part) => (
    part.type === 'tool-call' && typeof part.toolCallId === 'string'
      ? [part.toolCallId]
      : []
  ))
}

function toolResultIds(messages: ModelStepMessage[]): string[] {
  return messages.flatMap((message) => (
    message.role !== 'tool'
      ? []
      : contentParts(message).flatMap((part) => (
          part.type === 'tool-result' && typeof part.toolCallId === 'string'
            ? [part.toolCallId]
            : []
        ))
  ))
}

function withoutToolCalls(message: ModelStepMessage): ModelStepMessage | null {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return message
  const content = message.content.filter((part) => part.type !== 'tool-call')
  return content.length > 0 ? { ...message, content } : null
}

/**
 * 修复旧会话或异常截断留下的不完整工具消息组。
 * 供应商要求 assistant tool-calls 与紧随其后的全部 tool-result 成组出现；
 * 不能补齐时宁可移除未验证片段，也不能把孤立 role=tool 发给模型。
 */
export function normalizeModelToolMessagePairs(messages: ModelStepMessage[]): ModelStepMessage[] {
  const normalized: ModelStepMessage[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = modelStepMessageSchema.parse(messages[index])
    if (message.role === 'tool') continue
    const callIds = toolCallIds(message)
    if (callIds.length === 0) {
      normalized.push(message)
      continue
    }
    const followingTools: ModelStepMessage[] = []
    let cursor = index + 1
    while (cursor < messages.length && messages[cursor]?.role === 'tool') {
      followingTools.push(modelStepMessageSchema.parse(messages[cursor]))
      cursor += 1
    }
    const expected = new Set(callIds)
    const results = toolResultIds(followingTools)
    const complete = expected.size === callIds.length
      && results.length === expected.size
      && results.every((id) => expected.has(id))
    if (complete) {
      normalized.push(message, ...followingTools)
    } else {
      const retained = withoutToolCalls(message)
      if (retained) normalized.push(retained)
    }
    index = cursor - 1
  }
  return normalized
}

function toAiMessages(messages: ModelStepMessage[]): ModelMessage[] {
  return normalizeModelToolMessagePairs(messages) as unknown as ModelMessage[]
}

function buildTools(input: ModelStepInput): ToolSet | undefined {
  if (!input.tools?.length) return undefined
  if (!input.capabilities.toolCall) throw new Error('[unsupported_capability] Model does not support tool calling')
  return Object.fromEntries(input.tools.map((definition) => {
    // strict 只能如实声明：schema 不满足 strict 子集时降级，不为了凑格式篡改语义。
    const normalized = normalizeProviderToolSchema(definition.inputSchema, definition.strict)
    return [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema(normalized.schema as Parameters<typeof jsonSchema>[0]),
        strict: normalized.strict,
      }),
    ]
  }))
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
  assertModelStepInputCapabilities(input)
  if (input.trace) input.trace.inputModalities = detectModelStepInputModalities(input.messages)
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
