import { readCapabilityMediaSource } from '../../media'
import type { CapabilityExecutionContext } from '../../types'
import type {
  SpeechRecognitionEvent,
  SpeechRecognitionInput,
  SpeechRecognitionModule,
  SpeechRecognitionOutput,
} from '..'
import { AiRuntimeError, cancelledError } from '../../../runtime/AiRuntimeError'
import { parseGroqTranscription } from './parse'
import type { GroqAsrPreset } from './presets'
import type {
  GroqAsrModuleOptions,
  GroqAsrOptions,
  GroqTimestampGranularity,
  GroqTranscriptionResponseFormat,
} from './types'

type Context = CapabilityExecutionContext<SpeechRecognitionEvent>

const DEFAULT_API_BASE = 'https://api.groq.com/openai/v1'
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024

function endpoint(value: string | undefined): string {
  const normalized = (value?.trim() || DEFAULT_API_BASE).replace(/\/+$/, '')
  let parsed: URL
  try { parsed = new URL(normalized) } catch {
    throw new AiRuntimeError('invalid_endpoint', `Groq endpoint is invalid: ${normalized}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AiRuntimeError('invalid_endpoint', 'Groq endpoint must use HTTP(S)')
  }
  return normalized
}

function options(input: SpeechRecognitionInput): GroqAsrOptions {
  const raw = input.options
  if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw))) {
    throw new AiRuntimeError('invalid_parameter', 'Groq transcription options must be an object')
  }
  return (raw ?? {}) as GroqAsrOptions
}

function validateInput(input: SpeechRecognitionInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AiRuntimeError('invalid_parameter', 'Groq transcription input must be an object')
  }
  const audio = input.audio as unknown
  if (!audio || typeof audio !== 'object' || Array.isArray(audio)) {
    throw new AiRuntimeError('invalid_parameter', 'Groq transcription audio must be a media source')
  }
  const kind = (audio as Record<string, unknown>).kind
  if (kind !== 'bytes' && kind !== 'media-ref' && kind !== 'remote-url') {
    throw new AiRuntimeError('invalid_parameter', 'Groq transcription audio source kind is invalid')
  }
  const source = audio as Record<string, unknown>
  if (kind === 'bytes'
    && (!(source.bytes instanceof Uint8Array)
      || typeof source.mediaType !== 'string'
      || !source.mediaType.trim())) {
    throw new AiRuntimeError('invalid_parameter', 'Groq byte audio requires Uint8Array bytes and mediaType')
  }
  if (kind === 'media-ref' && (typeof source.ref !== 'string' || !source.ref.trim())) {
    throw new AiRuntimeError('invalid_parameter', 'Groq media-ref audio requires a non-empty ref')
  }
  if (kind === 'remote-url' && (typeof source.url !== 'string' || !source.url.trim())) {
    throw new AiRuntimeError('invalid_parameter', 'Groq remote audio requires a non-empty URL')
  }
  for (const field of ['mediaType', 'filename'] as const) {
    if (source[field] !== undefined && typeof source[field] !== 'string') {
      throw new AiRuntimeError('invalid_parameter', `Groq transcription audio.${field} must be a string`)
    }
  }
  if (input.language !== undefined && typeof input.language !== 'string') {
    throw new AiRuntimeError('invalid_parameter', 'Groq transcription language must be a string')
  }
  if (input.timestamps !== undefined && typeof input.timestamps !== 'boolean') {
    throw new AiRuntimeError('invalid_parameter', 'Groq transcription timestamps must be boolean')
  }
  options(input)
}

async function credential(context: Context): Promise<string> {
  const value = (await context.runtime.credentials.get('speech-recognition', 'groq'))?.trim()
  if (!value) throw new AiRuntimeError('api_key_missing', 'Groq speech-recognition API key is not configured')
  return value
}

function remoteUrl(value: string): string {
  let parsed: URL
  try { parsed = new URL(value) } catch {
    throw new AiRuntimeError('invalid_media_url', 'Groq transcription media URL is invalid')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AiRuntimeError('invalid_media_url', 'Groq transcription media URL must use HTTP(S)')
  }
  return parsed.toString()
}

function responseFormat(input: SpeechRecognitionInput, provider: GroqAsrOptions): GroqTranscriptionResponseFormat {
  const needsTimestamps = input.timestamps || Boolean(provider.timestampGranularities?.length)
  if (needsTimestamps && provider.responseFormat && provider.responseFormat !== 'verbose_json') {
    throw new AiRuntimeError(
      'invalid_parameter',
      'Groq timestamp granularities require responseFormat=verbose_json'
    )
  }
  if (needsTimestamps) return 'verbose_json'
  return provider.responseFormat ?? 'json'
}

function timestampGranularities(
  input: SpeechRecognitionInput,
  provider: GroqAsrOptions
): readonly GroqTimestampGranularity[] {
  if (!input.timestamps) return provider.timestampGranularities ?? []
  return provider.timestampGranularities?.length ? provider.timestampGranularities : ['segment']
}

function validateOptions(provider: GroqAsrOptions): void {
  if (provider.prompt !== undefined && typeof provider.prompt !== 'string') {
    throw new AiRuntimeError('invalid_parameter', 'Groq transcription prompt must be a string')
  }
  if (provider.responseFormat !== undefined
    && !['json', 'text', 'verbose_json'].includes(provider.responseFormat)) {
    throw new AiRuntimeError('invalid_parameter', 'Groq transcription responseFormat is invalid')
  }
  if (provider.temperature !== undefined
    && (typeof provider.temperature !== 'number'
      || !Number.isFinite(provider.temperature)
      || provider.temperature < 0
      || provider.temperature > 1)) {
    throw new AiRuntimeError('invalid_parameter', 'Groq transcription temperature must be between 0 and 1')
  }
  if (provider.timestampGranularities !== undefined) {
    if (!Array.isArray(provider.timestampGranularities)
      || provider.timestampGranularities.some((value) => value !== 'segment' && value !== 'word')) {
      throw new AiRuntimeError('invalid_parameter', 'Groq timestampGranularities must contain segment or word')
    }
    if (new Set(provider.timestampGranularities).size !== provider.timestampGranularities.length) {
      throw new AiRuntimeError('invalid_parameter', 'Groq timestampGranularities must not contain duplicates')
    }
  }
}

async function formData(
  preset: GroqAsrPreset,
  input: SpeechRecognitionInput,
  maxFileBytes: number,
  context: Context
): Promise<FormData> {
  const provider = options(input)
  validateOptions(provider)
  const form = new FormData()
  form.append('model', preset.modelId)
  if (input.audio.kind === 'remote-url') {
    form.append('url', remoteUrl(input.audio.url))
  } else {
    const media = await readCapabilityMediaSource(input.audio, context.runtime.media)
    if (media.bytes.byteLength === 0) throw new AiRuntimeError('invalid_media', 'Groq transcription audio is empty')
    if (media.bytes.byteLength > maxFileBytes) {
      throw new AiRuntimeError('media_too_large', `Groq transcription audio exceeds ${maxFileBytes} bytes`)
    }
    const uploadBytes = new Uint8Array(media.bytes.byteLength)
    uploadBytes.set(media.bytes)
    form.append('file', new Blob([uploadBytes], { type: media.mimeType }), media.filename)
  }
  if (input.language?.trim()) form.append('language', input.language.trim())
  if (provider.prompt?.trim()) form.append('prompt', provider.prompt.trim())
  if (provider.temperature !== undefined) form.append('temperature', String(provider.temperature))
  const format = responseFormat(input, provider)
  form.append('response_format', format)
  for (const granularity of timestampGranularities(input, provider)) {
    form.append('timestamp_granularities[]', granularity)
  }
  return form
}

function errorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const error = (payload as Record<string, unknown>).error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return undefined
  const message = (error as Record<string, unknown>).message
  return typeof message === 'string' && message.trim() ? message.trim() : undefined
}

async function parseResponse(response: Response, format: GroqTranscriptionResponseFormat): Promise<SpeechRecognitionOutput> {
  const body = await response.text()
  if (!response.ok) {
    let detail: string | undefined
    try { detail = errorMessage(JSON.parse(body)) } catch { detail = undefined }
    throw new AiRuntimeError(
      'provider_http_error',
      `Groq transcription failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`
    )
  }
  if (format === 'text') {
    const transcript = body.trim()
    if (!transcript) throw new AiRuntimeError('invalid_response', 'Groq transcription response has no text')
    return { text: transcript, providerMetadata: { responseFormat: 'text' } }
  }
  let payload: unknown
  try { payload = JSON.parse(body) } catch {
    throw new AiRuntimeError('invalid_response', 'Groq transcription returned invalid JSON')
  }
  return parseGroqTranscription(payload)
}

/** Create an on-demand Groq Whisper transcription module. */
export function createGroqAsrModule(
  preset: GroqAsrPreset,
  moduleOptions: GroqAsrModuleOptions = {}
): SpeechRecognitionModule {
  const apiBaseUrl = endpoint(moduleOptions.apiBaseUrl)
  const maxFileBytes = moduleOptions.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  if (!Number.isFinite(maxFileBytes) || maxFileBytes <= 0) {
    throw new AiRuntimeError('invalid_parameter', 'Groq maxFileBytes must be positive')
  }
  return {
    descriptor: preset.descriptor,
    execute: async (input, context) => {
      if (context.signal.aborted) throw cancelledError(context.requestId)
      validateInput(input)
      const apiKey = await credential(context)
      const provider = options(input)
      validateOptions(provider)
      const format = responseFormat(input, provider)
      const response = await context.runtime.transport.fetch(`${apiBaseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: await formData(preset, input, maxFileBytes, context),
        signal: context.signal,
      })
      const output = await parseResponse(response, format)
      if (output.segments?.length) {
        for (const segment of output.segments) await context.emit({ type: 'final', text: segment.text, segment })
      } else {
        await context.emit({ type: 'final', text: output.text })
      }
      await context.emit({ type: 'completed', output })
      return output
    },
  }
}
