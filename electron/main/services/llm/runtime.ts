import type { WebContents } from 'electron'
import { getLlmProviderApiKey } from '../keystore'
import { preprocessRequestBody } from '../ai-runtime/upload'
import { clearLlmTask, isLlmTaskCancelled, registerLlmTask, cancelLlmTask } from './task-registry'
import {
  buildOpenAiCompatiblePayload,
  resolveOpenAiCompatibleEndpoint,
  resolvePpioChatEndpoint,
  streamOpenAiCompatibleChat,
} from './streaming'
import type { JsonObject, JsonValue, LlmChatMessage, LlmChatRequestDto, LlmStreamEmitter } from './types'

export async function llmChatStream(
  request: LlmChatRequestDto,
  emit: LlmStreamEmitter,
  webContents?: WebContents
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

    webContents?.send('henji://llm-runtime-request-preview', {
      requestId: taskId,
      modelId: processedRequest.modelId,
      providerId: processedRequest.providerId,
      method: 'POST',
      route: endpoint,
      requestBody: buildOpenAiCompatiblePayload(processedRequest),
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

    emit({
      type: 'Done',
      data: {
        providerId: processedRequest.providerId,
        modelId: processedRequest.modelId,
        startedAtMs,
        elapsedMs: Date.now() - startedAtMs,
        inputChars,
        outputChars: output.output.length + output.reasoningOutput.length,
      },
    })
  } catch (error) {
    const message = normalizeLlmError(taskId, error)
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
