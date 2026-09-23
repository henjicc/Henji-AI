import { drainSseEvents } from '../protocols/sse-events'
import type { Transport } from '../runtime/Transport'
import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { fetchProvider } from '../providers/provider-fetch'
import {
  applyProviderRequestBodyQuirks,
  resolveProviderExtraAuthHeaders,
} from './providerProtocolCore'
import { applyProviderReasoningRequestBody } from './providerReasoningRequest'
import { createUtf8StreamDecoder } from './utf8-stream-decoder'
import { resolveLlmEndpointIdentity } from './endpointProfiles'
import type {
  JsonObject,
  JsonValue,
  LlmChatMessageDto,
  LlmChatRequestDto,
  LlmContentPart,
  LlmStreamEmitter,
  LlmStreamOutput,
  LlmStreamToolCall,
  LlmUsageDto,
} from './chatTypes'

/**
 * 原生 SSE 流式聊天路径的端点解析、请求体构建与流式读取。
 *
 * 任务 4.2 从 `electron/main/services/llm/streaming.ts` 迁入。唯一的实质改动：
 * `streamOpenAiCompatibleChat` 不再直接调用全局 `fetch`，改为接收调用方注入的
 * `Transport`（宿主网络能力，见 `../runtime/Transport.ts`）——`Transport.fetch()`
 * 返回标准 `Response`，`response.body` 本身就是标准 `ReadableStream<Uint8Array>`，
 * SSE 逐块读取（`readSseStream`）不需要 `Transport` 接口做任何扩展。
 */

interface StreamChatOptions {
  endpoint: string
  apiKey: string
  providerId: string
  payload: JsonObject
  signal: AbortSignal
  emit: LlmStreamEmitter
  transport: Transport
}

export function resolvePpioChatEndpoint(baseUrl?: string): string {
  const normalized = normalizeBaseUrl(baseUrl, 'https://api.ppio.com/openai')
  return /\/v\d+$/.test(normalized)
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`
}

export function resolveOpenAiCompatibleEndpoint(request: LlmChatRequestDto): string {
  const identity = resolveLlmEndpointIdentity(request)
  const providerId = identity.providerFamilyId
  const adapter = request.adapter?.trim().toLowerCase()
  const fallbackBaseUrl = providerId === 'openai' || adapter === 'openai'
    ? 'https://api.openai.com'
    : (providerId === 'deepseek' || adapter === 'deepseek' ? 'https://api.deepseek.com' : undefined)

  if (!identity.baseUrl && !fallbackBaseUrl) {
    throw new Error(`LLM provider "${request.providerId}" requires baseUrl.`)
  }

  const normalized = normalizeBaseUrl(identity.baseUrl, fallbackBaseUrl)
  return /\/v\d+$/.test(normalized)
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`
}

export function buildOpenAiCompatiblePayload(request: LlmChatRequestDto): JsonObject {
  const payload: JsonObject = {
    model: request.modelId,
    messages: request.messages.map(serializeMessage),
    stream: true,
    stream_options: { include_usage: true },
  }

  const maxTokens = resolveMaxOutputTokens(request)
  if (maxTokens !== undefined) payload.max_tokens = maxTokens

  if (request.tools !== undefined) {
    payload.tools = request.tools
  }

  /*
   * 思考参数按供应商翻译，与 SDK 模型步骤共用同一份映射。
   *
   * 旧实现只认 deepseek，且发的是 `reasoning: true` 而不是官方要求的 `thinking` + `reasoning_effort`：
   * 画布文本处理和提示词优化的「思考模式」下拉对任何供应商都不生效。
   * 用模型能力表兜一层，没标"支持思考"的模型仍然一个字段都不发。
   */
  const identity = resolveLlmEndpointIdentity(request)
  const withStructuredOutput = applyStructuredOutputRequestBody(
    request,
    identity.providerFamilyId,
    payload
  )
  const reasoningCapable = request.capabilities?.reasoning === true
  const withReasoning = reasoningCapable
    ? applyProviderReasoningRequestBody(
        identity.providerFamilyId,
        request.adapter,
        withStructuredOutput,
        request.reasoning
      )
    : withStructuredOutput

  return applyProviderRequestBodyQuirks(identity.providerFamilyId, withReasoning) as JsonObject
}

export async function streamOpenAiCompatibleChat(options: StreamChatOptions): Promise<LlmStreamOutput> {
  const response = await fetchProvider(options.providerId, options.endpoint, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${options.apiKey}`,
      ...resolveProviderExtraAuthHeaders(options.providerId, options.apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options.payload),
    signal: options.signal,
  }, {
    transport: options.transport,
    retryPreconnectOnce: true,
  })

  if (!response.ok) {
    const responseBody = await response.text()
    throw Object.assign(new Error(`LLM HTTP ${response.status}`), {
      statusCode: response.status,
      responseBody,
      responseHeaders: response.headers,
    })
  }
  if (!response.body) {
    throw new Error('LLM streaming response body is empty')
  }

  return await readSseStream(response.body, options)
}

export function serializeMessage(message: LlmChatMessageDto): JsonObject {
  const serialized: JsonObject = { role: message.role }
  if (message.name) {
    serialized.name = message.name
  }
  if (Array.isArray(message.content)) {
    serialized.content = message.content.map(serializeContentPart)
  } else if (message.content !== undefined) {
    serialized.content = message.content
  } else {
    serialized.content = null
  }
  return serialized
}

function serializeContentPart(part: LlmContentPart): JsonObject {
  const next: JsonObject = {}
  for (const [key, value] of Object.entries(part)) {
    if (value === undefined) continue
    if (key === 'fileId' || (key === 'file' && isRecord(value) && ('fileId' in value || 'file_id' in value))) {
      throw new Error('[unsupported_file_reference] LLM SDK does not create or accept provider file_id; use host-supplied fileUrl/fileData')
    }
    if (key === 'imageUrl') {
      next.image_url = value
    } else if (key === 'videoUrl') {
      next.video_url = value
    } else if (key === 'inputAudio') {
      next.input_audio = value
    } else if (key === 'file' && isRecord(value)) {
      const referenceCount = Number(typeof value.fileUrl === 'string' && value.fileUrl.length > 0)
        + Number(typeof value.fileData === 'string' && value.fileData.length > 0)
      if (referenceCount !== 1) {
        throw new Error('[invalid_file_reference] LLM file content requires exactly one of fileUrl or fileData')
      }
      const file: JsonObject = {}
      for (const [fileKey, fileValue] of Object.entries(value)) {
        if (fileValue === undefined) continue
        if (fileKey === 'fileUrl') file.file_url = fileValue as JsonValue
        else if (fileKey === 'fileData') file.file_data = fileValue as JsonValue
        else file[fileKey] = fileValue as JsonValue
      }
      next.file = file
    } else {
      next[key] = value
    }
  }
  return next
}

async function readSseStream(body: ReadableStream<Uint8Array>, options: StreamChatOptions): Promise<LlmStreamOutput> {
  const { emit, signal } = options
  const reader = body.getReader()
  const decoder = createUtf8StreamDecoder()
  let pending = ''
  let output = ''
  let reasoningOutput = ''
  let usage: LlmUsageDto | null = null
  let finishReason: string | null = null
  const toolCalls = new Map<number, LlmStreamToolCall>()

  let eof = false
  let stage = 'read'
  let cancellation: Promise<void> | undefined
  const cancelReader = (): void => {
    // Cleanup may reject on an already errored stream. It must not replace the
    // original protocol/transport failure or delay settlement on a custom host.
    cancellation ??= reader.cancel().catch(() => undefined)
  }
  const checkAbort = (): void => {
    if (signal.aborted) throw Object.assign(new Error('LLM stream cancelled'), { name: 'AbortError' })
  }
  const complete = (): LlmStreamOutput => {
    stage = 'completion'
    checkAbort()
    if (!finishReason) throw new AiRuntimeError('STREAM_INCOMPLETE', 'Chat stream ended without finish_reason')
    return { output, reasoningOutput, usage, finishReason,
      truncated: isOutputTruncated(finishReason), toolCalls: [...toolCalls.values()] }
  }
  signal.addEventListener('abort', cancelReader, { once: true })
  try {
    checkAbort()
    for (;;) {
      stage = 'read'
      const result = await reader.read()
      checkAbort()
      if (result.done) {
        eof = true
        // SSE dispatch requires a blank line. Do not manufacture a final event
        // from an unterminated block at EOF.
        return complete()
      }
      pending += decoder.decode(result.value, { stream: true })
      const parsed = drainSseEvents(pending)
      pending = parsed.remaining
      for (const event of parsed.events) {
        checkAbort()
        stage = 'parse'
        const chunk = parseSseData(event, options.providerId)
        if (chunk.done) return complete()
        if (finishReason && (chunk.content || chunk.reasoning || chunk.toolCalls?.length
          || (chunk.finishReason && chunk.finishReason !== finishReason))) {
          throw new AiRuntimeError('INVALID_STREAM_RESPONSE', 'Chat result changed after finish_reason')
        }
        usage = chunk.usage ?? usage
        finishReason = chunk.finishReason ?? finishReason
        mergeToolCallDeltas(toolCalls, chunk.toolCalls)
        stage = 'emit'
        if (chunk.reasoning) {
          reasoningOutput += chunk.reasoning
          emit({ type: 'ReasoningToken', data: chunk.reasoning })
        }
        if (chunk.content) {
          output += chunk.content
          emit({ type: 'Token', data: chunk.content })
        }
      }
    }
  } catch (error) {
    if (error instanceof AiRuntimeError) {
      throw new AiRuntimeError(error.code, 'Chat streaming response failed', {
        providerId: options.providerId, modelId: options.payload.model,
        protocol: 'openai-chat-sse', stage, receivedFinish: finishReason !== null,
      })
    }
    throw error
  } finally {
    signal.removeEventListener('abort', cancelReader)
    if (!eof) cancelReader()
    reader.releaseLock()
  }
}

function applyStructuredOutputRequestBody(
  request: LlmChatRequestDto,
  providerId: string,
  body: JsonObject
): JsonObject {
  const output = request.structuredOutput
  if (!output) return body
  if (output.type === 'text') {
    return { ...body, response_format: { type: 'text' } }
  }

  const supportedMode = request.capabilities?.structuredOutputMode ?? 'none'
  if (output.type === 'json_object' && supportedMode === 'none') {
    throw invalidRequest(
      'STRUCTURED_OUTPUT_JSON_OBJECT_UNSUPPORTED',
      `Model "${request.modelId}" is not declared to support JSON Object output.`
    )
  }
  if (output.type === 'json_schema' && supportedMode !== 'schema') {
    throw invalidRequest(
      'STRUCTURED_OUTPUT_JSON_SCHEMA_UNSUPPORTED',
      `Model "${request.modelId}" is not declared to support JSON Schema output.`
    )
  }
  if (request.reasoning?.enabled === true) {
    if (request.capabilities?.reasoning !== true) {
      throw invalidRequest(
        'REASONING_UNSUPPORTED',
        `Model "${request.modelId}" is not declared to support reasoning.`
      )
    }
    const compatibility = request.capabilities.structuredOutputWithReasoning
    if (compatibility !== true) {
      throw invalidRequest(
        compatibility === false
          ? 'STRUCTURED_OUTPUT_WITH_REASONING_UNSUPPORTED'
          : 'STRUCTURED_OUTPUT_WITH_REASONING_CAPABILITY_REQUIRED',
        compatibility === false
          ? `Model "${request.modelId}" does not support structured output with reasoning enabled.`
          : `Model "${request.modelId}" must explicitly declare structuredOutputWithReasoning before structured output and reasoning can be combined.`
      )
    }
  }

  if (output.type === 'json_object') {
    return { ...body, response_format: { type: 'json_object' } }
  }
  if (providerId.trim().toLowerCase() === 'groq') {
    throw invalidRequest(
      'STRUCTURED_OUTPUT_STREAMING_UNSUPPORTED',
      'Groq does not support JSON Schema structured output with streaming.'
    )
  }
  if (!output.name.trim()) {
    throw invalidRequest('INVALID_STRUCTURED_OUTPUT', 'JSON Schema output requires a non-empty name.')
  }
  if (!isRecord(output.schema)) {
    throw invalidRequest('INVALID_STRUCTURED_OUTPUT', 'JSON Schema output requires schema to be an object.')
  }
  if (typeof output.strict !== 'boolean') {
    throw invalidRequest('INVALID_STRUCTURED_OUTPUT', 'JSON Schema output requires an explicit strict boolean.')
  }
  return {
    ...body,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: output.name.trim(),
        schema: output.schema,
        strict: output.strict,
      },
    },
  }
}

function resolveMaxOutputTokens(request: LlmChatRequestDto): number | undefined {
  const policy = request.policy ?? {}
  const legacy = policy.max_tokens ?? policy.maxTokens
  const candidate = request.maxOutputTokens ?? legacy
  if (candidate === undefined) return undefined
  if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate <= 0) {
    throw invalidRequest('INVALID_MAX_OUTPUT_TOKENS', 'maxOutputTokens must be a positive integer.')
  }
  const modelLimit = request.capabilities?.maxOutputTokens
  if (typeof modelLimit === 'number' && candidate > modelLimit) {
    throw invalidRequest(
      'MAX_OUTPUT_TOKENS_EXCEEDED',
      `Requested ${candidate} output tokens, but model "${request.modelId}" declares a limit of ${modelLimit}.`
    )
  }
  return candidate
}

function invalidRequest(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, statusCode: 400 })
}

function isOutputTruncated(finishReason: string | null): boolean {
  return finishReason === 'length' || finishReason === 'max_tokens' || finishReason === 'max_output_tokens'
}

function parseSseData(event: string, providerId: string): {
  done: boolean
  content?: string
  reasoning?: string
  usage?: LlmUsageDto
  finishReason?: string
  toolCalls?: LlmStreamToolCall[]
} {
  const eventName = event.split(/\r\n|\r|\n/)
    .filter(line => line.startsWith('event:')).at(-1)?.slice(6).trim()
  const data = event
    .split(/\r\n|\r|\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')

  if (eventName === 'error' && !data) throw new AiRuntimeError('PROVIDER_STREAM_ERROR', 'Server error event')
  if (!data) return { done: false }
  if (data === '[DONE]' && (!eventName || eventName === 'message')) return { done: true }

  let json: unknown
  try { json = JSON.parse(data) as unknown } catch {
    throw new AiRuntimeError('INVALID_STREAM_RESPONSE', 'Invalid SSE JSON')
  }
  if (eventName === 'error' || (isRecord(json) && json.error != null)) {
    const error = isRecord(json) && isRecord(json.error) ? json.error : json
    const code = isRecord(error) && typeof error.code === 'string' && /^[\w.-]{1,80}$/.test(error.code)
      ? error.code : 'PROVIDER_STREAM_ERROR'
    throw new AiRuntimeError(code, 'Server error event')
  }
  if (eventName && eventName !== 'message' && eventName !== 'chat.completion.chunk') return { done: false }
  // BigModel's documented SDK consumer permits status-only chunks without
  // choices. This does not make them completion evidence or allow wrong types.
  const statusOnlyAllowed = providerId === 'bigmodel'
  if (statusOnlyAllowed && isRecord(json) && json.choices === undefined) {
    return { done: false, usage: readUsage(json) }
  }
  if (!isRecord(json) || !Array.isArray(json.choices)) {
    throw new AiRuntimeError('INVALID_STREAM_RESPONSE', 'Chat chunk has no choices array')
  }
  if (json.choices.length === 0) {
    if (!statusOnlyAllowed && !isRecord(json.usage)) throw new AiRuntimeError('INVALID_STREAM_RESPONSE', 'Empty choices without usage')
    return { done: false, usage: readUsage(json) }
  }
  const first = json.choices[0]
  if (!isRecord(first) || !isRecord(first.delta)
    || (first.finish_reason != null && (typeof first.finish_reason !== 'string' || !first.finish_reason.trim()))) {
    throw new AiRuntimeError('INVALID_STREAM_RESPONSE', 'Invalid Chat choice')
  }
  for (const field of ['content', 'reasoning_content', 'reasoning']) {
    if (first.delta[field] != null && typeof first.delta[field] !== 'string') {
      throw new AiRuntimeError('INVALID_STREAM_RESPONSE', 'Invalid Chat text delta')
    }
  }
  const delta = readDelta(json)
  return {
    done: false,
    content: readString(delta.content),
    reasoning: readString(delta.reasoning_content ?? delta.reasoning),
    usage: readUsage(json),
    finishReason: readFinishReason(json),
    toolCalls: readToolCallDeltas(delta.tool_calls),
  }
}

function readToolCallDeltas(value: unknown): LlmStreamToolCall[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item, arrayIndex) => {
    if (!isRecord(item)) return []
    const fn = isRecord(item.function) ? item.function : {}
    const index = typeof item.index === 'number' && Number.isInteger(item.index) ? item.index : arrayIndex
    return [{
      index,
      id: typeof item.id === 'string' ? item.id : '',
      type: typeof item.type === 'string' ? item.type : 'function',
      function: {
        name: typeof fn.name === 'string' ? fn.name : '',
        arguments: typeof fn.arguments === 'string' ? fn.arguments : '',
      },
    }]
  })
}

function mergeToolCallDeltas(
  target: Map<number, LlmStreamToolCall>,
  deltas: LlmStreamToolCall[] | undefined
): void {
  for (const delta of deltas ?? []) {
    const current = target.get(delta.index)
    target.set(delta.index, current ? {
      index: delta.index,
      id: delta.id || current.id,
      type: delta.type || current.type,
      function: {
        name: delta.function.name || current.function.name,
        arguments: current.function.arguments + delta.function.arguments,
      },
    } : delta)
  }
}

function readUsage(value: unknown): LlmUsageDto | undefined {
  if (!isRecord(value) || !isRecord(value.usage)) return undefined
  const usage = value.usage
  const inputDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {}
  const outputDetails = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {}
  return {
    inputTokens: readTokenCount(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: readTokenCount(usage.completion_tokens ?? usage.output_tokens),
    reasoningTokens: readTokenCount(outputDetails.reasoning_tokens ?? usage.reasoning_tokens),
    cacheReadTokens: readTokenCount(inputDetails.cached_tokens ?? usage.cache_read_tokens),
    cacheWriteTokens: readTokenCount(usage.cache_write_tokens),
    totalTokens: readTokenCount(usage.total_tokens),
  }
}

function readFinishReason(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.choices)) return undefined
  const first = value.choices[0]
  return isRecord(first) ? readString(first.finish_reason) : undefined
}

function readDelta(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  const choices = value.choices
  if (!Array.isArray(choices)) return {}
  const first = choices[0]
  if (!isRecord(first) || !isRecord(first.delta)) return {}
  return first.delta
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function normalizeBaseUrl(input: string | undefined, fallback: string | undefined): string {
  const raw = input?.trim() || fallback
  if (!raw) {
    throw new Error('LLM baseUrl is required')
  }
  return raw.replace(/\/+$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
