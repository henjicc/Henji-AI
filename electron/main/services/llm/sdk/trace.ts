import {
  agentTraceDetailSchema,
  type AgentTraceDetail,
} from '../../../../../src/core/assistant/trace'
import {
  fitAgentTraceDetail,
  sanitizeAgentTraceHttpRequest,
  sanitizeAgentTraceHttpResponse,
  serializedBytes,
} from '../../../../../src/core/assistant/traceSanitize'
import type { ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import type { ModelStepHttpTrace } from './provider'
import type { ModelStepStreamTrace } from './model-step'

export const AGENT_TRACE_DETAIL_MAX_BYTES = 8 * 1024 * 1024
const AGENT_TRACE_CAPTURE_RESERVE_BYTES = 8 * 1024
const AGENT_TRACE_DETAIL_CONTENT_MAX_BYTES =
  AGENT_TRACE_DETAIL_MAX_BYTES - AGENT_TRACE_CAPTURE_RESERVE_BYTES

export function createModelStepStreamTrace(): ModelStepStreamTrace {
  return {
    startedAt: Date.now(),
    firstChunkMs: null,
    totalEventCount: 0,
    textDeltaCount: 0,
    reasoningDeltaCount: 0,
    toolCallCount: 0,
    textCharacters: 0,
    reasoningCharacters: 0,
  }
}

export function buildModelStepTraceDetail(
  input: ModelStepInput,
  httpTrace: ModelStepHttpTrace,
  streamTrace: ModelStepStreamTrace,
  result?: ModelStepResult,
  error?: unknown
): AgentTraceDetail {
  const raw: Record<string, unknown> = {
    schemaVersion: 'agent-trace/v1',
    logicalRequest: {
      system: input.system,
      messages: input.messages,
      tools: input.tools,
      output: input.output,
      capabilities: input.capabilities,
      reasoning: input.reasoning,
      settings: input.settings,
      providerOptions: input.providerOptions,
      context: input.trace,
    },
    httpRequest: httpTrace.request ? sanitizeAgentTraceHttpRequest(httpTrace.request) : undefined,
    httpResponse: httpTrace.response ? sanitizeAgentTraceHttpResponse(httpTrace.response) : undefined,
    response: result ? {
      text: result.text,
      reasoningText: result.reasoningText,
      structuredOutput: result.structuredOutput,
      toolCalls: result.toolCalls,
      responseMessages: result.responseMessages,
      finishReason: result.finishReason,
      usage: result.usage,
      providerMetadataSummary: result.providerMetadataSummary,
      warnings: result.warnings,
    } : undefined,
    stream: {
      firstChunkMs: streamTrace.firstChunkMs,
      totalEventCount: streamTrace.totalEventCount,
      textDeltaCount: streamTrace.textDeltaCount,
      reasoningDeltaCount: streamTrace.reasoningDeltaCount,
      toolCallCount: streamTrace.toolCallCount,
      textCharacters: streamTrace.textCharacters,
      reasoningCharacters: streamTrace.reasoningCharacters,
    },
    error: error ? {
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
      code: error instanceof Error ? error.message.match(/^\[([^\]]+)]/)?.[1] : undefined,
    } : undefined,
  }

  const fitted = fitAgentTraceDetail(
    raw,
    AGENT_TRACE_DETAIL_CONTENT_MAX_BYTES,
    ['httpRequest', 'httpResponse', 'response', 'stream'],
    ['schemaVersion', 'logicalRequest']
  )
  const logicalRequest = fitted.value.logicalRequest
  let safeLogicalRequest = normalizeLogicalRequest(logicalRequest, input)
  let detailWithoutCapture: Record<string, unknown> = {
    ...fitted.value,
    logicalRequest: safeLogicalRequest,
  }
  for (const key of ['httpRequest', 'httpResponse', 'response', 'stream', 'error']) {
    if (key in detailWithoutCapture && !isRecord(detailWithoutCapture[key])) {
      delete detailWithoutCapture[key]
    }
  }
  const extraSections = [...fitted.sections]
  if (serializedBytes(detailWithoutCapture) > AGENT_TRACE_DETAIL_CONTENT_MAX_BYTES) {
    safeLogicalRequest = shrinkLogicalRequest(input)
    detailWithoutCapture = { ...detailWithoutCapture, logicalRequest: safeLogicalRequest }
    extraSections.push('logicalRequest')
  }
  if (serializedBytes(detailWithoutCapture) > AGENT_TRACE_DETAIL_CONTENT_MAX_BYTES) {
    detailWithoutCapture = {
      schemaVersion: 'agent-trace/v1',
      logicalRequest: {
        messages: [{ role: 'user', content: '[trace-detail-over-limit]' }],
        output: input.output,
        capabilities: input.capabilities,
        context: input.trace,
      },
      error: error ? {
        name: error instanceof Error ? error.name : undefined,
        message: error instanceof Error ? error.message.slice(0, 4_000) : String(error).slice(0, 4_000),
      } : undefined,
    }
    extraSections.push('traceDetail')
  }
  const originalBytes = Math.max(fitted.originalBytes, serializedBytes(detailWithoutCapture))
  const detail = {
    ...detailWithoutCapture,
    capture: {
      truncated: fitted.truncated || originalBytes > AGENT_TRACE_DETAIL_MAX_BYTES,
      originalBytes,
      storedBytes: 0,
      sections: [...new Set(extraSections)],
    },
  }
  detail.capture.storedBytes = serializedBytes(detail)
  if (detail.capture.storedBytes > AGENT_TRACE_DETAIL_MAX_BYTES) {
    return createMinimalTraceDetail(input, error, detail.capture.originalBytes)
  }
  return agentTraceDetailSchema.parse(detail)
}

function createMinimalTraceDetail(
  input: ModelStepInput,
  error: unknown,
  originalBytes: number
): AgentTraceDetail {
  const detail: AgentTraceDetail = {
    schemaVersion: 'agent-trace/v1',
    logicalRequest: {
      messages: [{ role: 'user', content: '[trace-detail-over-limit]' }],
      output: input.output,
      capabilities: input.capabilities,
      context: input.trace,
    },
    ...(error ? {
      error: {
        name: error instanceof Error ? error.name : undefined,
        message: error instanceof Error
          ? error.message.slice(0, 4_000)
          : String(error).slice(0, 4_000),
      },
    } : {}),
    capture: {
      truncated: true,
      originalBytes,
      storedBytes: 0,
      sections: ['traceDetail'],
    },
  }
  detail.capture.storedBytes = serializedBytes(detail)
  return agentTraceDetailSchema.parse(detail)
}

function shrinkLogicalRequest(input: ModelStepInput): Record<string, unknown> {
  const retainedMessages = input.messages.slice(-20).map((message) => {
    if (typeof message.content === 'string') {
      return { ...message, content: summarizeText(message.content, 24 * 1024) }
    }
    return message
  })
  if (input.messages.length > retainedMessages.length) {
    retainedMessages.unshift({
      role: 'user',
      content: `[前 ${input.messages.length - retainedMessages.length} 条消息因追踪体积限制省略]`,
    })
  }
  return {
    system: input.system ? summarizeText(input.system, 128 * 1024) : undefined,
    messages: retainedMessages,
    tools: input.tools ? {
      truncated: true,
      count: input.tools.length,
      names: input.tools.map((tool) => tool.name),
    } : undefined,
    output: input.output,
    capabilities: input.capabilities,
    reasoning: input.reasoning,
    settings: input.settings,
    context: input.trace,
  }
}

function summarizeText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const tail = Math.min(512, Math.floor(maxLength / 4))
  return `${value.slice(0, maxLength - tail)}...(len=${value.length}, trace-limit)...${value.slice(-tail)}`
}

function normalizeLogicalRequest(value: unknown, input: ModelStepInput): Record<string, unknown> {
  if (!isRecord(value)) {
    return {
      messages: input.messages,
      output: input.output,
      capabilities: input.capabilities,
      context: input.trace,
    }
  }
  const messages = Array.isArray(value.messages) ? value.messages : input.messages
  return {
    system: typeof value.system === 'string' ? value.system : input.system,
    messages,
    tools: value.tools,
    output: value.output ?? input.output,
    capabilities: value.capabilities ?? input.capabilities,
    reasoning: value.reasoning,
    settings: value.settings,
    providerOptions: value.providerOptions,
    context: value.context ?? input.trace,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
