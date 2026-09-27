import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { volcengineRequestId } from '../capabilities/speech-recognition/volcengine/request-id'
import { createUtf8StreamDecoder } from '../protocols/utf8-stream-decoder'
import type { JsonValue, ProviderContinuePollingInput, ProviderExecutionInput, ProviderExecutionResult } from '../types/runtime'
import { fromBase64 } from '../upload/base64'
import { audioBytesToDataUri } from './audio-data'
import { isJsonObject, normalizeEndpoint } from './helpers'
import { fetchProvider } from './provider-fetch'
import { executeVoiceClone, pollVoiceClone } from './volcengine-voice-clone'

const BASE_URL = 'https://openspeech.bytedance.com'
const ENDPOINT = '/api/v3/tts/unidirectional'

function decodeChunk(encoded: string): Uint8Array {
  try {
    return fromBase64(encoded)
  } catch {
    throw new AiRuntimeError('invalid_response', 'Volcengine speech returned invalid base64 audio')
  }
}

function parseFrame(payload: string, audio: Uint8Array[], usage: { textWords?: number }): void {
  if (!payload) return
  let value: JsonValue
  try {
    value = JSON.parse(payload) as JsonValue
  } catch {
    throw new AiRuntimeError('invalid_response', 'Volcengine speech returned invalid JSON frame')
  }
  if (!isJsonObject(value) || value.code !== 0) {
    throw new AiRuntimeError('provider_task_failed', isJsonObject(value) && typeof value.message === 'string' ? value.message : 'Volcengine speech failed')
  }
  if (typeof value.data === 'string' && value.data.length > 0) audio.push(decodeChunk(value.data))
  if (isJsonObject(value.usage) && typeof value.usage.text_words === 'number') usage.textWords = value.usage.text_words
}

function consumeFrames(buffer: string, audio: Uint8Array[], usage: { textWords?: number }): string {
  let start = -1
  let depth = 0
  let quoted = false
  let escaped = false
  let consumed = 0
  for (let index = 0; index < buffer.length; index += 1) {
    const character = buffer[index]
    if (start < 0) {
      if (/\s/.test(character)) { consumed = index + 1; continue }
      if (character !== '{') throw new AiRuntimeError('invalid_response', 'Volcengine speech returned invalid JSON frame')
      start = index
      depth = 1
      continue
    }
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') quoted = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        parseFrame(buffer.slice(start, index + 1), audio, usage)
        start = -1
        consumed = index + 1
      }
    }
  }
  return buffer.slice(start < 0 ? consumed : start)
}

export async function execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  if (input.route === '/api/v3/tts/voice_clone') return executeVoiceClone(input)
  if (!isJsonObject(input.body) || !isJsonObject(input.body.req_params)) {
    throw new AiRuntimeError('invalid_request', 'Volcengine speech requires req_params')
  }
  const resourceId = input.body.resource_id
  if (resourceId !== 'seed-tts-2.0' && resourceId !== 'seed-icl-2.0') {
    throw new AiRuntimeError('invalid_request', 'Volcengine speech resource ID is invalid')
  }
  const response = await fetchProvider('Volcengine Speech', normalizeEndpoint(BASE_URL, ENDPOINT), {
    method: 'POST',
    headers: {
      'X-Api-Key': input.apiKey,
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': volcengineRequestId(input.requestId, undefined),
      'X-Control-Require-Usage-Tokens-Return': '*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ req_params: input.body.req_params }),
    signal: input.signal,
  }, { transport: input.runtime.transport, retryPreconnectOnce: false })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new AiRuntimeError('provider_task_failed', `Volcengine speech request failed (HTTP ${response.status})`)
  }
  if (!response.body) throw new AiRuntimeError('empty_result', 'Volcengine speech returned no body')
  const reader = response.body.getReader()
  const decoder = createUtf8StreamDecoder()
  const audio: Uint8Array[] = []
  const usage: { textWords?: number } = {}
  let pending = ''
  const cancelReader = () => { void reader.cancel(input.signal?.reason).catch(() => undefined) }
  input.signal?.addEventListener('abort', cancelReader, { once: true })
  try {
    while (true) {
      input.signal?.throwIfAborted()
      const { done, value } = await reader.read()
      input.signal?.throwIfAborted()
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true })
      pending = consumeFrames(pending, audio, usage)
      if (done) break
    }
    if (pending.trim()) throw new AiRuntimeError('invalid_response', 'Volcengine speech returned incomplete JSON frame')
  } finally {
    input.signal?.removeEventListener('abort', cancelReader)
    reader.releaseLock()
  }
  const total = audio.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of audio) { joined.set(chunk, offset); offset += chunk.byteLength }
  return {
    status: 'completed',
    url: audioBytesToDataUri(joined, 'mp3'),
    metadata: { byteLength: total, ...(usage.textWords === undefined ? {} : { textWords: usage.textWords }),
      ...(resourceId === 'seed-icl-2.0' && typeof input.body.req_params.speaker === 'string'
        ? { activatedVoiceId: input.body.req_params.speaker } : {}),
    },
  }
}

export async function continuePolling(input: ProviderContinuePollingInput): Promise<ProviderExecutionResult> {
  return pollVoiceClone(input)
}
