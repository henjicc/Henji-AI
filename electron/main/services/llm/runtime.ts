import { getLlmProviderApiKey } from '../keystore'
import { preprocessRequestBody } from '../ai-runtime/upload'
import { createMainLogger, sanitizeJsonValue } from '../logging'
import { clearLlmTask, isLlmTaskCancelled, registerLlmTask, cancelLlmTask } from './task-registry'
import {
  buildOpenAiCompatiblePayload,
  resolveOpenAiCompatibleEndpoint,
  resolvePpioChatEndpoint,
  streamOpenAiCompatibleChat,
} from './streaming'
import type { JsonObject, JsonValue, LlmChatMessage, LlmChatRequestDto, LlmStreamEmitter } from './types'

// 主进程直接记录 LLM 请求/响应/失败三类事件，落盘 henji-*.log（source: 'backend'）；
// 日志窗口（2.1）通过 henji://log-event 实时订阅同一份事件，不再需要
// henji://llm-runtime-request-preview 这条给旧查看器用的预览通道。
const logger = createMainLogger('llm-runtime')

function toLogError(error: unknown): unknown {
  return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error
}

export async function llmChatStream(
  request: LlmChatRequestDto,
  emit: LlmStreamEmitter
): Promise<void> {
  const taskId = resolveTaskId(request)
  const controller = new AbortController()
  const startedAtMs = Date.now()
  const inputChars = countInputChars(request.messages)

  registerLlmTask(taskId, controller)

  try {
    const apiKey = getLlmProviderApiKey(request.providerId)
    if (!apiKey) {
      throw new Error(`[api_key_missing] LLM provider "${request.providerId}" API key is not configured.`)
    }

    const processedRequest = await preprocessLlmRequest(request)
    const endpoint = request.providerId.trim().toLowerCase() === 'ppio'
      ? resolvePpioChatEndpoint(processedRequest.baseUrl)
      : resolveOpenAiCompatibleEndpoint(processedRequest)
    const requestPayload = buildOpenAiCompatiblePayload(processedRequest)

    logger.info('后端发起 LLM 请求', {
      event: 'llm_runtime.chat_stream.request_json',
      requestId: taskId,
      modelId: processedRequest.modelId,
      providerId: processedRequest.providerId,
      context: {
        method: 'POST',
        route: endpoint,
        requestBody: sanitizeJsonValue(requestPayload),
      },
    })

    const output = await streamOpenAiCompatibleChat({
      endpoint,
      apiKey,
      request: processedRequest,
      signal: controller.signal,
      emit,
    })

    if (isLlmTaskCancelled(taskId)) {
      throw new Error(`[task_cancelled] LLM task cancelled: ${taskId}`)
    }

    const elapsedMs = Date.now() - startedAtMs
    const outputChars = output.output.length + output.reasoningOutput.length

    logger.info('后端 LLM 响应完成', {
      event: 'llm_runtime.chat_stream.response_json',
      requestId: taskId,
      modelId: processedRequest.modelId,
      providerId: processedRequest.providerId,
      context: {
        startedAtMs,
        elapsedMs,
        inputChars,
        outputChars,
        output: sanitizeJsonValue(output.output),
        reasoningOutput: sanitizeJsonValue(output.reasoningOutput),
      },
    })

    emit({
      type: 'Done',
      data: {
        providerId: processedRequest.providerId,
        modelId: processedRequest.modelId,
        startedAtMs,
        elapsedMs,
        inputChars,
        outputChars,
      },
    })
  } catch (error) {
    const message = normalizeLlmError(taskId, error)
    logger.error('后端 LLM 请求失败', {
      event: 'llm_runtime.chat_stream.failed',
      requestId: taskId,
      modelId: request.modelId,
      providerId: request.providerId,
      context: { normalizedMessage: message },
      error: toLogError(error),
    })
    emit({ type: 'Error', data: message })
    throw new Error(message)
  } finally {
    clearLlmTask(taskId)
  }
}

export function cancelLlmRuntimeTask(taskId: string): void {
  cancelLlmTask(taskId)
}

async function preprocessLlmRequest(request: LlmChatRequestDto): Promise<LlmChatRequestDto> {
  const body: JsonObject = { messages: request.messages as unknown as JsonValue }
  const params = request.metadata ?? {}
  const processed = await preprocessRequestBody(request.providerId, '/v1/chat/completions', body, params)
  const processedBody = isJsonObject(processed) ? processed : body
  const processedMessages = Array.isArray(processedBody.messages)
    ? processedBody.messages as unknown as LlmChatMessage[]
    : request.messages
  return { ...request, messages: processedMessages }
}

function resolveTaskId(request: LlmChatRequestDto): string {
  const fromRequest = request.requestId?.trim()
  return fromRequest || `llm-${request.modelId}-${Date.now()}`
}

function countInputChars(messages: LlmChatMessage[]): number {
  return messages.reduce((sum, message) => sum + countMessageContent(message.content), 0)
}

function countMessageContent(content: LlmChatMessage['content']): number {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  return content.reduce((sum, part) => sum + (typeof part.text === 'string' ? part.text.length : 0), 0)
}

function normalizeLlmError(taskId: string, error: unknown): string {
  if (isLlmTaskCancelled(taskId) || isAbortError(error)) {
    return `[task_cancelled] LLM task cancelled: ${taskId}`
  }
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
