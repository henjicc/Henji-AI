import {
  modelStepEventSchema,
  modelStepInputSchema,
  modelStepResultSchema,
  modelStepToolCallSchema,
  type ModelStepEvent,
  type ModelStepFinishReason,
  type ModelStepInput,
  type ModelStepResult,
  type ModelStepToolCall,
  type ModelStepUsage,
} from '../../../../../src/core/llm/modelStep'
import type { ModelProviderErrorCategory } from '../../../../../src/core/llm/providerProtocol'
import { ProviderModelStepError } from './provider-error'

export type ScriptedModelStepAction =
  | { type: 'text'; value: string }
  | { type: 'reasoning'; value: string }
  | { type: 'tool_call'; toolCall: ModelStepToolCall }
  | { type: 'delay'; ms: number }
  | { type: 'finish'; reason: ModelStepFinishReason; usage?: Partial<ModelStepUsage> }
  | {
      type: 'error'
      code: string
      category: ModelProviderErrorCategory
      status?: number | null
      retryable?: boolean
      retryAfterMs?: number | null
    }
  | { type: 'invalid_event'; event: unknown }

interface ScriptedModelStepOptions {
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}

function defaultUsage(patch: Partial<ModelStepUsage> = {}): ModelStepUsage {
  return {
    inputTokens: 0,
    inputNoCacheTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    textTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    knownCostUsd: null,
    ...patch,
  }
}

function sleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('[task_cancelled] Scripted model step aborted')
}

export function createScriptedModelStepExecutor(
  script: ScriptedModelStepAction[],
  options: ScriptedModelStepOptions = {}
): (
  input: ModelStepInput,
  emit: (event: ModelStepEvent) => void,
  signal?: AbortSignal
) => Promise<ModelStepResult> {
  const wait = options.sleep ?? sleep
  const now = options.now ?? Date.now
  return async (rawInput, emit, externalSignal): Promise<ModelStepResult> => {
    const input = modelStepInputSchema.parse(rawInput)
    const signal = externalSignal ?? new AbortController().signal
    const startedAt = now()
    let text = ''
    let reasoningText = ''
    let finishReason: ModelStepFinishReason = 'stop'
    let usage = defaultUsage()
    const toolCalls: ModelStepToolCall[] = []
    for (const action of script) {
      throwIfAborted(signal)
      if (action.type === 'delay') {
        await wait(action.ms, signal)
      } else if (action.type === 'text') {
        text += action.value
        emit(modelStepEventSchema.parse({ type: 'TextDelta', text: action.value }))
      } else if (action.type === 'reasoning') {
        reasoningText += action.value
        emit(modelStepEventSchema.parse({ type: 'ReasoningDelta', text: action.value }))
      } else if (action.type === 'tool_call') {
        const toolCall = modelStepToolCallSchema.parse(action.toolCall)
        toolCalls.push(toolCall)
        emit(modelStepEventSchema.parse({ type: 'ToolCall', toolCall }))
      } else if (action.type === 'finish') {
        finishReason = action.reason
        usage = defaultUsage(action.usage)
      } else if (action.type === 'invalid_event') {
        modelStepEventSchema.parse(action.event)
      } else {
        throw new ProviderModelStepError({
          code: action.code,
          category: action.category,
          status: action.status ?? null,
          retryable: action.retryable ?? ['network', 'rate_limit', 'server'].includes(action.category),
          retryAfterMs: action.retryAfterMs ?? null,
          providerId: input.providerId,
          modelId: input.modelId,
          requestId: input.requestId,
          message: `脚本化模型错误：${action.category}`,
        })
      }
    }
    throwIfAborted(signal)
    const content: Array<Record<string, unknown>> = []
    if (reasoningText) content.push({ type: 'reasoning', text: reasoningText })
    if (text) content.push({ type: 'text', text })
    for (const call of toolCalls) content.push({ type: 'tool-call', ...call })
    return modelStepResultSchema.parse({
      requestId: input.requestId,
      runId: input.runId,
      stepId: input.stepId,
      providerId: input.providerId,
      modelId: input.modelId,
      text,
      reasoningText,
      structuredOutput: null,
      toolCalls,
      responseMessages: [{ role: 'assistant', content: content.length ? content : text }],
      finishReason,
      usage,
      providerMetadataSummary: { scripted: ['deterministic'] },
      warnings: [],
      elapsedMs: Math.max(0, now() - startedAt),
    })
  }
}
