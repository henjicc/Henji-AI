import { drainSseEvents } from '../protocols/sse-events'
import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { fetchProvider } from '../providers/provider-fetch'
import type { Transport } from '../runtime/Transport'
import { resolveProviderExtraAuthHeaders } from './providerProtocolCore'
import { resolveLlmEndpointIdentity } from './endpointProfiles'
import { createUtf8StreamDecoder } from './utf8-stream-decoder'
import {
  applyLlmRequestOptions,
  invalidRequest,
  isOutputTruncated,
  readUsage,
  resolveMaxOutputTokens,
  resolveStructuredOutputFormat,
} from './streaming'
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
 * 轻量入口的 OpenAI Responses 流式路径：手写 SSE 解析，不依赖 Web Streams 与 Vercel AI SDK，
 * 输出与 Chat Completions 路径同一套 LlmStreamEventDto / LlmStreamOutput。
 *
 * 只发无状态请求（store: false），每次带完整历史；思考文本同时认 reasoning_text（DeepSeek、MiMo 等返回原文）
 * 与 reasoning_summary_text（OpenAI、火山等返回摘要）两种事件。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function imageUrlOf(value: JsonValue | undefined): { url: string; detail?: string } | null {
  if (typeof value === 'string' && value) return { url: value }
  if (isRecord(value) && typeof value.url === 'string' && value.url) {
    return { url: value.url, ...(typeof value.detail === 'string' ? { detail: value.detail } : {}) }
  }
  return null
}

function toResponsesContentPart(part: LlmContentPart, role: LlmChatMessageDto['role']): JsonObject {
  if (part.type === 'text') {
    return { type: role === 'assistant' ? 'output_text' : 'input_text', text: part.text ?? '' }
  }
  if (part.type === 'image_url') {
    const image = imageUrlOf(part.imageUrl)
    if (!image) throw invalidRequest('INVALID_IMAGE_REFERENCE', 'Responses image content requires imageUrl.url')
    return { type: 'input_image', image_url: image.url, detail: image.detail ?? 'auto' }
  }
  if (part.type === 'file' && isRecord(part.file)) {
    const file = part.file
    const fileUrl = typeof file.fileUrl === 'string' ? file.fileUrl : undefined
    const fileData = typeof file.fileData === 'string' ? file.fileData : undefined
    if (Number(Boolean(fileUrl)) + Number(Boolean(fileData)) !== 1) {
      throw invalidRequest('INVALID_FILE_REFERENCE', 'LLM file content requires exactly one of fileUrl or fileData')
    }
    return {
      type: 'input_file',
      ...(fileUrl ? { file_url: fileUrl } : { file_data: fileData as string }),
      ...(typeof file.filename === 'string' ? { filename: file.filename } : {}),
    }
  }
  // Responses 的输入项没有通用的视频与音频内容块；静默丢弃会让模型以为没收到素材。
  throw invalidRequest('RESPONSES_CONTENT_UNSUPPORTED', `Responses API does not accept "${part.type}" content; use Chat Completions for this model.`)
}

function toResponsesInputItem(message: LlmChatMessageDto): JsonObject {
  if (!Array.isArray(message.content)) return { role: message.role, content: message.content ?? '' }
  return { role: message.role, content: message.content.map(part => toResponsesContentPart(part, message.role)) }
}

/** Chat 形状的函数工具 {type:'function', function:{…}} 转为 Responses 的扁平形状，其他工具原样。 */
function toResponsesTool(tool: JsonValue): JsonValue {
  if (!isRecord(tool) || tool.type !== 'function' || !isRecord(tool.function)) return tool
  const fn = tool.function
  return {
    type: 'function',
    name: fn.name as JsonValue,
    ...(fn.description !== undefined ? { description: fn.description as JsonValue } : {}),
    ...(fn.parameters !== undefined ? { parameters: fn.parameters as JsonValue } : {}),
    ...(fn.strict !== undefined ? { strict: fn.strict as JsonValue } : {}),
  }
}

/** Responses 请求体的协议骨架；思考、采样、联网工具与供应商差异由调用方按同一套规则叠加。 */
export function buildResponsesPayloadBase(request: LlmChatRequestDto, providerId: string): JsonObject {
  const payload: JsonObject = {
    model: request.modelId,
    input: request.messages.map(toResponsesInputItem),
    stream: true,
    store: false,
  }
  const maxTokens = resolveMaxOutputTokens(request)
  if (maxTokens !== undefined) payload.max_output_tokens = maxTokens
  if (Array.isArray(request.tools)) payload.tools = request.tools.map(toResponsesTool)
  else if (request.tools !== undefined) payload.tools = request.tools
  const format = resolveStructuredOutputFormat(request, providerId)
  if (format) {
    payload.text = {
      format: format.type === 'json_schema'
        ? { type: 'json_schema', name: format.name, schema: format.schema as JsonValue, strict: format.strict }
        : { type: format.type },
    }
  }
  return payload
}

/** 轻量入口发送的完整 Responses 请求体，叠加规则与 Chat 路径同一份。 */
export function buildResponsesPayload(request: LlmChatRequestDto): JsonObject {
  const providerFamilyId = resolveLlmEndpointIdentity(request).providerFamilyId
  return applyLlmRequestOptions(request, providerFamilyId, buildResponsesPayloadBase(request, providerFamilyId), 'openai-responses')
}

export interface StreamResponsesOptions {
  endpoint: string
  apiKey: string
  providerId: string
  payload: JsonObject
  signal: AbortSignal
  emit: LlmStreamEmitter
  transport: Transport
}

export async function streamResponses(options: StreamResponsesOptions): Promise<LlmStreamOutput> {
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
  }, { transport: options.transport, retryPreconnectOnce: true })
  if (!response.ok) {
    const responseBody = await response.text()
    throw Object.assign(new Error(`LLM HTTP ${response.status}`), {
      statusCode: response.status,
      responseBody,
      responseHeaders: response.headers,
    })
  }
  if (!response.body) throw new Error('LLM streaming response body is empty')
  return await readResponsesStream(response.body, options)
}

interface ResponsesStreamState {
  output: string
  reasoningOutput: string
  usage: LlmUsageDto | null
  finishReason: string | null
  toolCalls: Map<number, LlmStreamToolCall>
}

function providerErrorCode(value: unknown): string {
  return isRecord(value) && typeof value.code === 'string' && /^[\w.-]{1,80}$/.test(value.code) ? value.code : 'PROVIDER_STREAM_ERROR'
}

/** 处理一个 SSE 事件；返回 true 表示收到终止事件。 */
function applyResponsesEvent(state: ResponsesStreamState, data: string, emit: LlmStreamEmitter): boolean {
  let event: unknown
  try { event = JSON.parse(data) as unknown } catch {
    throw new AiRuntimeError('INVALID_STREAM_RESPONSE', 'Invalid SSE JSON')
  }
  if (!isRecord(event) || typeof event.type !== 'string') {
    throw new AiRuntimeError('INVALID_STREAM_RESPONSE', 'Responses event has no type')
  }
  const index = typeof event.output_index === 'number' ? event.output_index : 0
  switch (event.type) {
    case 'response.output_text.delta':
      if (typeof event.delta === 'string' && event.delta) {
        state.output += event.delta
        emit({ type: 'Token', data: event.delta })
      }
      return false
    case 'response.reasoning_text.delta':
    case 'response.reasoning_summary_text.delta':
      if (typeof event.delta === 'string' && event.delta) {
        state.reasoningOutput += event.delta
        emit({ type: 'ReasoningToken', data: event.delta })
      }
      return false
    case 'response.output_item.added':
    case 'response.output_item.done': {
      const item = event.item
      if (isRecord(item) && item.type === 'function_call') {
        const current = state.toolCalls.get(index)
        state.toolCalls.set(index, {
          index,
          id: typeof item.call_id === 'string' ? item.call_id : current?.id ?? '',
          type: 'function',
          function: {
            name: typeof item.name === 'string' ? item.name : current?.function.name ?? '',
            // done 事件带完整参数，以它为准；added 时通常为空，后续由 delta 累积
            arguments: typeof item.arguments === 'string' && (event.type === 'response.output_item.done' || item.arguments)
              ? item.arguments : current?.function.arguments ?? '',
          },
        })
      }
      return false
    }
    case 'response.function_call_arguments.delta': {
      const current = state.toolCalls.get(index)
      if (current && typeof event.delta === 'string') current.function.arguments += event.delta
      return false
    }
    case 'response.completed':
    case 'response.incomplete': {
      const result = isRecord(event.response) ? event.response : {}
      state.usage = readUsage(result) ?? state.usage
      if (event.type === 'response.incomplete') {
        const details = isRecord(result.incomplete_details) ? result.incomplete_details : {}
        state.finishReason = typeof details.reason === 'string' && details.reason ? details.reason : 'incomplete'
      } else {
        state.finishReason = state.toolCalls.size > 0 ? 'tool_calls' : 'stop'
      }
      return true
    }
    case 'response.failed': {
      const result = isRecord(event.response) ? event.response : {}
      throw new AiRuntimeError(providerErrorCode(result.error), 'Responses request failed')
    }
    case 'error':
      throw new AiRuntimeError(providerErrorCode(event.error ?? event), 'Server error event')
    default:
      // 其余事件（created、in_progress、content_part、联网工具调用进度等）不影响输出
      return false
  }
}

async function readResponsesStream(body: ReadableStream<Uint8Array>, options: StreamResponsesOptions): Promise<LlmStreamOutput> {
  const { emit, signal } = options
  const reader = body.getReader()
  const decoder = createUtf8StreamDecoder()
  const state: ResponsesStreamState = { output: '', reasoningOutput: '', usage: null, finishReason: null, toolCalls: new Map() }
  let pending = ''
  let eof = false
  let stage = 'read'
  let cancellation: Promise<void> | undefined
  const cancelReader = (): void => { cancellation ??= reader.cancel().catch(() => undefined) }
  const checkAbort = (): void => {
    if (signal.aborted) throw Object.assign(new Error('LLM stream cancelled'), { name: 'AbortError' })
  }
  const complete = (): LlmStreamOutput => {
    stage = 'completion'
    checkAbort()
    if (!state.finishReason) throw new AiRuntimeError('STREAM_INCOMPLETE', 'Responses stream ended without a terminal event')
    return {
      output: state.output,
      reasoningOutput: state.reasoningOutput,
      usage: state.usage,
      finishReason: state.finishReason,
      truncated: isOutputTruncated(state.finishReason, options.providerId),
      toolCalls: [...state.toolCalls.values()],
    }
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
        return complete()
      }
      pending += decoder.decode(result.value, { stream: true })
      const parsed = drainSseEvents(pending)
      pending = parsed.remaining
      for (const event of parsed.events) {
        checkAbort()
        stage = 'parse'
        const data = event.split(/\r\n|\r|\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
        if (!data || data === '[DONE]') continue
        if (applyResponsesEvent(state, data, emit)) return complete()
      }
    }
  } catch (error) {
    if (error instanceof AiRuntimeError) {
      throw new AiRuntimeError(error.code, 'Responses streaming response failed', {
        providerId: options.providerId, modelId: options.payload.model,
        protocol: 'openai-responses-sse', stage, receivedFinish: state.finishReason !== null,
      })
    }
    throw error
  } finally {
    signal.removeEventListener('abort', cancelReader)
    if (!eof) cancelReader()
    reader.releaseLock()
  }
}
