import { preprocessRequestBody } from '../upload'
import type { RuntimeContext } from '../runtime'
import {
  cancelTask,
  clearCancelFlag,
  isCancelled,
  normalizeProviderError,
  registerAbortController,
} from '../runtime'
import {
  buildOpenAiCompatiblePayload,
  resolveOpenAiCompatibleEndpoint,
  resolvePpioChatEndpoint,
  streamOpenAiCompatibleChat,
} from './streaming'
import type {
  JsonObject,
  JsonValue,
  LlmChatMessageDto,
  LlmChatRequestDto,
  LlmStreamEmitter,
} from './chatTypes'

/**
 * 原生 SSE 流式聊天路径（`llm:chatStream`）的编排逻辑：取密钥 → 预处理请求体
 * （复用 2.4 迁入的 `preprocessRequestBody`）→ 解析 endpoint → 构建 payload → 发流式请求。
 *
 * 任务 4.2 从 `electron/main/services/llm/runtime.ts` 的 `llmChatStream` 拆出。
 * **日志落盘与 `Done`/`Error` IPC 事件发射刻意不在这里**——那是宿主（痕迹AI 主进程）的
 * 结构化日志格式与 IPC 契约，SDK 不应该固化具体的日志事件名/字段命名。取而代之，
 * `runLlmChatStream` 通过可选的 `hooks` 在关键节点（请求已构建、请求已完成）把结构化数据
 * 交还给调用方，调用方决定怎么记日志；Token/ReasoningToken 仍然通过 `emit` 实时转发
 * （这是流式协议本身的一部分，不是"日志"）。`Done`/`Error` 事件的发射与取消任务清理，
 * 由调用方（`electron/main/services/llm/runtime.ts`）在 `runLlmChatStream` 外层负责，
 * 与迁移前 `llmChatStream` 的行为逐字段对齐。
 */

export interface LlmChatRequestBuiltInfo {
  endpoint: string
  requestPayload: JsonObject
  processedRequest: LlmChatRequestDto
}

export interface LlmChatCompletedInfo {
  processedRequest: LlmChatRequestDto
  startedAtMs: number
  elapsedMs: number
  inputChars: number
  outputChars: number
  output: string
  reasoningOutput: string
}

export interface LlmChatStreamHooks {
  /** 请求体与 endpoint 已经构建好，即将发出网络请求前触发一次。 */
  onRequestBuilt?: (info: LlmChatRequestBuiltInfo) => void
  /** 流式响应正常读完（未被取消、未抛错）后触发一次。 */
  onCompleted?: (info: LlmChatCompletedInfo) => void
}

export interface LlmChatStreamOutcome {
  providerId: string
  modelId: string
  startedAtMs: number
  elapsedMs: number
  inputChars: number
  outputChars: number
}

/** taskId 只应该在一次调用里计算一次（`request.requestId` 缺省时会落到 `Date.now()`），调用方与本函数必须复用同一个值。 */
export function resolveLlmTaskId(request: LlmChatRequestDto): string {
  const fromRequest = request.requestId?.trim()
  return fromRequest || `llm-${request.modelId}-${Date.now()}`
}

export function cancelLlmChatTask(taskId: string): void {
  cancelTask('llm', taskId)
}

export async function runLlmChatStream(
  request: LlmChatRequestDto,
  taskId: string,
  emit: LlmStreamEmitter,
  runtime: RuntimeContext,
  hooks: LlmChatStreamHooks = {}
): Promise<LlmChatStreamOutcome> {
  const controller = new AbortController()
  const startedAtMs = Date.now()
  const inputChars = countInputChars(request.messages)
  const span = runtime.tracer?.startSpan('llm.chat', {
    requestId: taskId,
    providerId: request.providerId,
    modelId: request.modelId,
  })

  registerAbortController('llm', taskId, controller)

  try {
    const apiKey = await runtime.credentials.get('llm', request.providerId)
    if (!apiKey) {
      throw new Error(`[api_key_missing] LLM provider "${request.providerId}" API key is not configured.`)
    }

    const processedRequest = await preprocessLlmRequest(request, runtime)
    const endpoint = processedRequest.providerId.trim().toLowerCase() === 'ppio'
      ? resolvePpioChatEndpoint(processedRequest.baseUrl)
      : resolveOpenAiCompatibleEndpoint(processedRequest)
    const requestPayload = buildOpenAiCompatiblePayload(processedRequest)

    hooks.onRequestBuilt?.({ endpoint, requestPayload, processedRequest })

    const output = await streamOpenAiCompatibleChat({
      endpoint,
      apiKey,
      request: processedRequest,
      signal: controller.signal,
      emit,
      transport: runtime.transport,
    })

    if (isCancelled('llm', taskId)) {
      throw new Error(`[task_cancelled] LLM task cancelled: ${taskId}`)
    }

    const elapsedMs = Date.now() - startedAtMs
    const outputChars = output.output.length + output.reasoningOutput.length

    hooks.onCompleted?.({
      processedRequest,
      startedAtMs,
      elapsedMs,
      inputChars,
      outputChars,
      output: output.output,
      reasoningOutput: output.reasoningOutput,
    })

    span?.end()
    return {
      providerId: processedRequest.providerId,
      modelId: processedRequest.modelId,
      startedAtMs,
      elapsedMs,
      inputChars,
      outputChars,
    }
  } catch (error) {
    span?.end(error)
    throw new Error(normalizeLlmChatError(taskId, error, {
      providerId: request.providerId,
      modelId: request.modelId,
      requestId: taskId,
    }))
  } finally {
    clearCancelFlag('llm', taskId)
  }
}

async function preprocessLlmRequest(request: LlmChatRequestDto, runtime: RuntimeContext): Promise<LlmChatRequestDto> {
  const body: JsonObject = { messages: request.messages as unknown as JsonValue }
  const params = request.metadata ?? {}
  const processed = await preprocessRequestBody(
    request.providerId,
    '/v1/chat/completions',
    body,
    runtime,
    params
  )
  const processedBody = isJsonObject(processed) ? processed : body
  const processedMessages = Array.isArray(processedBody.messages)
    ? processedBody.messages as unknown as LlmChatMessageDto[]
    : request.messages
  return { ...request, messages: processedMessages }
}

function countInputChars(messages: LlmChatMessageDto[]): number {
  return messages.reduce((sum, message) => sum + countMessageContent(message.content), 0)
}

function countMessageContent(content: LlmChatMessageDto['content']): number {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  return content.reduce((sum, part) => sum + (typeof part.text === 'string' ? part.text.length : 0), 0)
}

export function normalizeLlmChatError(
  taskId: string,
  error: unknown,
  context?: { providerId: string; modelId: string; requestId: string }
): string {
  if (isCancelled('llm', taskId) || isAbortError(error)) {
    return `[task_cancelled] LLM task cancelled: ${taskId}`
  }
  if (error instanceof Error && error.message.startsWith('[api_key_missing]')) {
    return error.message
  }
  if (context) return normalizeProviderError(context, error).message
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
