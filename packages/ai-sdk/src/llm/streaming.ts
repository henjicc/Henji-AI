import type { Transport } from '../runtime/Transport'
import { fetchProvider } from '../providers/provider-fetch'
import {
  applyProviderRequestBodyQuirks,
  resolveProviderExtraAuthHeaders,
} from './providerProtocol'
import { applyProviderReasoningRequestBody } from './providerReasoningRequest'
import type {
  JsonObject,
  JsonValue,
  LlmChatMessageDto,
  LlmChatRequestDto,
  LlmContentPart,
  LlmStreamEmitter,
  LlmStreamOutput,
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
  request: LlmChatRequestDto
  signal: AbortSignal
  emit: LlmStreamEmitter
  transport: Transport
}

export function resolvePpioChatEndpoint(baseUrl?: string): string {
  const normalized = normalizeBaseUrl(baseUrl, 'https://api.ppio.com/openai')
  return normalized.endsWith('/v1')
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`
}

export function resolveOpenAiCompatibleEndpoint(request: LlmChatRequestDto): string {
  const providerId = request.providerId.trim().toLowerCase()
  const adapter = request.adapter?.trim().toLowerCase()
  const fallbackBaseUrl = providerId === 'openai' || adapter === 'openai'
    ? 'https://api.openai.com'
    : (providerId === 'deepseek' || adapter === 'deepseek' ? 'https://api.deepseek.com' : undefined)

  if (!request.baseUrl && !fallbackBaseUrl) {
    throw new Error(`LLM provider "${request.providerId}" requires baseUrl.`)
  }

  const normalized = normalizeBaseUrl(request.baseUrl, fallbackBaseUrl)
  return normalized.endsWith('/v1')
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`
}

export function buildOpenAiCompatiblePayload(request: LlmChatRequestDto): JsonObject {
  const policy = request.policy ?? {}
  const payload: JsonObject = {
    model: request.modelId,
    messages: request.messages.map(serializeMessage),
    stream: true,
    stream_options: { include_usage: true },
  }

  const maxTokens = readNumber(policy.max_tokens ?? policy.maxTokens)
  payload.max_tokens = maxTokens ?? 4096

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
  const reasoningCapable = request.capabilities?.reasoning === true
  const withReasoning = reasoningCapable
    ? applyProviderReasoningRequestBody(request.providerId, request.adapter, payload, request.reasoning)
    : payload

  return applyProviderRequestBodyQuirks(request.providerId, withReasoning) as JsonObject
}

export async function streamOpenAiCompatibleChat(options: StreamChatOptions): Promise<LlmStreamOutput> {
  const response = await fetchProvider(options.request.providerId, options.endpoint, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${options.apiKey}`,
      ...resolveProviderExtraAuthHeaders(options.request.providerId, options.apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildOpenAiCompatiblePayload(options.request)),
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

  return await readSseStream(response.body, options.emit)
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
    if (key === 'imageUrl') {
      next.image_url = value
    } else if (key === 'videoUrl') {
      next.video_url = value
    } else if (key === 'inputAudio') {
      next.input_audio = value
    } else {
      next[key] = value
    }
  }
  return next
}

async function readSseStream(body: ReadableStream<Uint8Array>, emit: LlmStreamEmitter): Promise<LlmStreamOutput> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let output = ''
  let reasoningOutput = ''

  let streamDone = false
  while (!streamDone) {
    const result = await reader.read()
    if (result.done) {
      streamDone = true
      continue
    }
    pending += decoder.decode(result.value, { stream: true })

    const parsed = drainSseEvents(pending)
    pending = parsed.remaining
    for (const event of parsed.events) {
      const chunk = parseSseData(event)
      if (chunk.done) {
        return { output, reasoningOutput }
      }
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

  const flushed = decoder.decode()
  if (flushed) {
    pending += flushed
  }
  const parsed = drainSseEvents(`${pending}\n\n`)
  for (const event of parsed.events) {
    const chunk = parseSseData(event)
    if (chunk.reasoning) {
      reasoningOutput += chunk.reasoning
      emit({ type: 'ReasoningToken', data: chunk.reasoning })
    }
    if (chunk.content) {
      output += chunk.content
      emit({ type: 'Token', data: chunk.content })
    }
  }
  return { output, reasoningOutput }
}

function drainSseEvents(input: string): { events: string[]; remaining: string } {
  const events: string[] = []
  let remaining = input
  let hasSeparator = true
  while (hasSeparator) {
    const separator = findNextSeparator(remaining)
    if (!separator) {
      hasSeparator = false
      continue
    }
    if (separator) {
      events.push(remaining.slice(0, separator.index))
      remaining = remaining.slice(separator.index + separator.length)
    }
  }
  return { events, remaining }
}

function findNextSeparator(input: string): { index: number; length: number } | undefined {
  const crlf = input.indexOf('\r\n\r\n')
  const lf = input.indexOf('\n\n')
  if (crlf === -1 && lf === -1) return undefined
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 }
  return { index: lf, length: 2 }
}

function parseSseData(event: string): { done: boolean; content?: string; reasoning?: string } {
  const data = event
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')

  if (!data) return { done: false }
  if (data === '[DONE]') return { done: true }

  const json = JSON.parse(data) as unknown
  const delta = readDelta(json)
  return {
    done: false,
    content: readString(delta.content),
    reasoning: readString(delta.reasoning_content ?? delta.reasoning),
  }
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

function readNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
