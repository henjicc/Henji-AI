import type {
  AgentEventInput,
  SerializedAgentError,
} from '../../../../../src/core/assistant/events'
import {
  agentToolObservationSchema,
  type AgentToolObservation,
} from '../../../../../src/core/assistant/toolContracts'
import type {
  ModelStepFinishReason,
  ModelStepResult,
  ModelStepToolCall,
} from '@henjicc/ai-sdk'
import type { AgentToolRegistry } from '../tools/registry'
import { digestJson } from '../tools/security'

export const MODEL_OUTPUT_INCOMPLETE_CODE = 'MODEL_OUTPUT_INCOMPLETE' as const
const INVALID_TOOL_INPUT_DIGEST = digestJson({ invalidToolInput: true })

interface AgentModelOutputGuardOptions {
  registry: AgentToolRegistry
  emit: (event: AgentEventInput) => void
  onObservation: (call: ModelStepToolCall, observation: AgentToolObservation) => void
  onRecoveryMessage: (message: string) => void
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function tryDigestJson(value: unknown): string | null {
  try {
    return digestJson(value)
  } catch {
    return null
  }
}

function hasCompleteToolCallEnvelope(result: ModelStepResult): boolean {
  const responseCalls = result.responseMessages.flatMap((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return []
    return message.content.flatMap((part) => {
      const record = asRecord(part)
      return record?.type === 'tool-call' ? [record] : []
    })
  })
  if (responseCalls.length !== result.toolCalls.length) return false
  const callsById = new Map<string, Record<string, unknown>>()
  for (const call of responseCalls) {
    if (typeof call.toolCallId !== 'string' || callsById.has(call.toolCallId)) return false
    callsById.set(call.toolCallId, call)
  }
  return result.toolCalls.every((call) => {
    const responseCall = callsById.get(call.toolCallId)
    if (!responseCall || !Object.prototype.hasOwnProperty.call(responseCall, 'input')) return false
    const callDigest = tryDigestJson(call.input)
    const responseDigest = tryDigestJson(responseCall.input)
    return responseCall.toolName === call.toolName
      && callDigest !== null
      && responseDigest === callDigest
  })
}

function incompleteReason(result: ModelStepResult): string | null {
  // 部分 OpenAI-compatible 供应商会把本应位于协议层的工具调用串直接塞进普通文本，并以
  // stop + 0 toolCalls 结束。若把它当最终答复，UI 会显示整段 DSML/XML，世界也不会发生
  // 文本中声称的调用。只有 SDK 解析出的结构化 toolCalls 才有执行资格。
  const serializedToolProtocol = /(?:<｜｜DSML｜｜tool_calls>|<\|tool_calls\|>|<tool_calls?>)[\s\S]{0,16384}(?:invoke\s+name=|<tool_call|<function[=>])/i
  if (serializedToolProtocol.test(result.text)) {
    return '模型把工具调用协议序列化成了普通文本，没有返回可执行的结构化工具调用。'
  }
  switch (result.finishReason) {
    case 'stop':
      // 部分 OpenAI-compatible 服务会在完整 tool-call 后仍返回 stop；
      // SDK 已完成参数解析，允许这条兼容路径。
      return hasCompleteToolCallEnvelope(result)
        ? null
        : '模型工具调用与 assistant 响应消息不一致，无法证明参数完整。'
    case 'tool-calls':
      if (result.toolCalls.length === 0) {
        return '模型声明已产生工具调用，但没有返回任何完整的工具调用。'
      }
      return hasCompleteToolCallEnvelope(result)
        ? null
        : '模型工具调用与 assistant 响应消息不一致，无法证明参数完整。'
    case 'length':
      return '模型响应达到输出长度上限，内容或工具参数可能已被截断。'
    case 'content-filter':
      return '模型响应被内容过滤器提前终止，内容或工具参数不完整。'
    case 'error':
      return '模型供应商以错误状态结束响应，无法确认内容或工具参数完整。'
    case 'other':
      return '模型以未明确证明完整的原因结束响应。'
    default:
      return '模型以契约未识别的原因结束响应。'
  }
}

function incompleteError(
  finishReason: ModelStepFinishReason,
  reason: string
): SerializedAgentError {
  return {
    code: MODEL_OUTPUT_INCOMPLETE_CODE,
    message: `${reason} 本响应中的工具调用均未执行。`,
    retryable: true,
    recovery: 'none',
  }
}

function incompleteObservation(
  call: ModelStepToolCall,
  toolVersion: number,
  finishReason: ModelStepFinishReason,
  error: SerializedAgentError
): AgentToolObservation {
  return agentToolObservationSchema.parse({
    source: { toolName: call.toolName, toolVersion, toolCallId: call.toolCallId },
    trust: 'untrusted_observation',
    dataClasses: ['C0'],
    summary: `工具未执行：模型输出未通过完整性校验（${finishReason}）。请重新发出参数完整的工具调用。`,
    output: {
      ok: false,
      error,
      finishReason,
      executed: false,
    },
  })
}

function recoveryMessage(
  finishReason: ModelStepFinishReason,
  reason: string,
  toolCallCount: number
): string {
  const toolGuidance = toolCallCount > 0
    ? `本响应中的 ${toolCallCount} 个工具调用均未执行；请重新发出参数完整的工具调用，不得声称它们已经执行。`
    : '请重新生成完整响应；需要工具时发出参数完整的工具调用。'
  return [
    '[模型输出完整性恢复要求]',
    `上一模型响应以 ${finishReason} 结束：${reason}`,
    toolGuidance,
  ].join('\n')
}

/**
 * 在工具调度器之前裁决模型输出。返回 false 时，所有模型工具调用都已转换为
 * MODEL_OUTPUT_INCOMPLETE 观察结果，且没有进入 gateway、approval 或 ledger。
 */
export class AgentModelOutputGuard {
  constructor(private readonly options: AgentModelOutputGuardOptions) {}

  accept(result: ModelStepResult): boolean {
    const reason = incompleteReason(result)
    if (!reason) return true

    const error = incompleteError(result.finishReason, reason)
    for (const call of result.toolCalls) {
      const metadata = this.options.registry.executionMetadata(call.toolName, call.input)
      this.options.emit({
        type: 'ToolRequested',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        title: metadata?.title,
        inputDigest: tryDigestJson(call.input) ?? INVALID_TOOL_INPUT_DIGEST,
        category: metadata?.category,
        readOnly: metadata?.readOnly,
        idempotent: metadata?.idempotent,
      })
      this.options.onObservation(
        call,
        incompleteObservation(
          call,
          this.options.registry.get(call.toolName)?.version ?? 1,
          result.finishReason,
          error
        )
      )
      this.options.emit({
        type: 'ToolFailed',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        error,
        category: metadata?.category,
        readOnly: metadata?.readOnly,
        idempotent: metadata?.idempotent,
      })
    }
    this.options.onRecoveryMessage(recoveryMessage(
      result.finishReason,
      reason,
      result.toolCalls.length
    ))
    return false
  }
}
