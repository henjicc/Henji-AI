import { readCapabilityMediaSource } from '../../media'
import type { CapabilityExecutionContext } from '../../types'
import type {
  SpeechRecognitionEvent,
  SpeechRecognitionInput,
  SpeechRecognitionModule,
  SpeechRecognitionOutput,
} from '..'
import { AiRuntimeError, cancelledError } from '../../../runtime/AiRuntimeError'
import type { SiliconFlowAsrPreset } from './presets'
import type { SiliconFlowAsrModuleOptions } from './types'

type Context = CapabilityExecutionContext<SpeechRecognitionEvent>
type UnknownRecord = Record<string, unknown>

const DEFAULT_API_BASE = 'https://api.siliconflow.cn/v1'
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024

function endpoint(value: string | undefined): string {
  const normalized = (value?.trim() || DEFAULT_API_BASE).replace(/\/+$/, '')
  let parsed: URL
  try { parsed = new URL(normalized) } catch {
    throw new AiRuntimeError('invalid_endpoint', `SiliconFlow endpoint is invalid: ${normalized}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AiRuntimeError('invalid_endpoint', 'SiliconFlow endpoint must use HTTP(S)')
  }
  return normalized
}

async function credential(context: Context): Promise<string> {
  const value = (await context.runtime.credentials.get('speech-recognition', 'siliconflow'))?.trim()
  if (!value) {
    throw new AiRuntimeError('api_key_missing', 'SiliconFlow speech-recognition API key is not configured')
  }
  return value
}

function validateInput(input: SpeechRecognitionInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AiRuntimeError('invalid_parameter', 'SiliconFlow transcription input must be an object')
  }
  const audio = input.audio as unknown
  if (!audio || typeof audio !== 'object' || Array.isArray(audio)) {
    throw new AiRuntimeError('invalid_parameter', 'SiliconFlow transcription audio must be a media source')
  }
  const kind = (audio as Record<string, unknown>).kind
  if (kind !== 'bytes' && kind !== 'media-ref' && kind !== 'remote-url') {
    throw new AiRuntimeError('invalid_parameter', 'SiliconFlow transcription audio source kind is invalid')
  }
  const source = audio as Record<string, unknown>
  if (kind === 'bytes'
    && (!(source.bytes instanceof Uint8Array)
      || typeof source.mediaType !== 'string'
      || !source.mediaType.trim())) {
    throw new AiRuntimeError('invalid_parameter', 'SiliconFlow byte audio requires Uint8Array bytes and mediaType')
  }
  if (kind === 'media-ref' && (typeof source.ref !== 'string' || !source.ref.trim())) {
    throw new AiRuntimeError('invalid_parameter', 'SiliconFlow media-ref audio requires a non-empty ref')
  }
  if (kind === 'remote-url' && (typeof source.url !== 'string' || !source.url.trim())) {
    throw new AiRuntimeError('invalid_parameter', 'SiliconFlow remote audio requires a non-empty URL')
  }
  for (const field of ['mediaType', 'filename'] as const) {
    if (source[field] !== undefined && typeof source[field] !== 'string') {
      throw new AiRuntimeError('invalid_parameter', `SiliconFlow transcription audio.${field} must be a string`)
    }
  }
  if (input.language !== undefined && typeof input.language !== 'string') {
    throw new AiRuntimeError('invalid_parameter', 'SiliconFlow transcription language must be a string')
  }
  if (input.timestamps !== undefined && typeof input.timestamps !== 'boolean') {
    throw new AiRuntimeError('invalid_parameter', 'SiliconFlow transcription timestamps must be boolean')
  }
  if (input.options !== undefined
    && (!input.options || typeof input.options !== 'object' || Array.isArray(input.options))) {
    throw new AiRuntimeError('invalid_parameter', 'SiliconFlow transcription options must be an object')
  }
}

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function responseText(payload: unknown): string | undefined {
  const value = record(payload)?.text
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function diagnosticValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  if (value === undefined) return undefined
  try { return JSON.stringify(value).slice(0, 500) } catch { return undefined }
}

function providerError(payload: unknown): string[] {
  if (typeof payload === 'string') {
    const detail = diagnosticValue(payload)
    return detail ? [detail] : []
  }
  const root = record(payload)
  if (!root) return []
  const nested = record(root.error)
  const fields: Array<[string, unknown]> = [
    ['code', root.code ?? nested?.code],
    ['message', root.message ?? nested?.message],
    ['data', Object.prototype.hasOwnProperty.call(root, 'data') ? root.data : nested?.data],
  ]
  return fields.flatMap(([label, value]) => {
    const detail = diagnosticValue(value)
    return detail === undefined ? [] : [`${label}=${detail}`]
  })
}

async function parseResponse(response: Response): Promise<SpeechRecognitionOutput> {
  const body = await response.text()
  let payload: unknown
  try { payload = JSON.parse(body) } catch {
    if (!response.ok) {
      const detail = body.trim().slice(0, 500)
      throw new AiRuntimeError(
        'provider_http_error',
        `SiliconFlow transcription failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`
      )
    }
    throw new AiRuntimeError('invalid_response', 'SiliconFlow transcription returned invalid JSON')
  }
  if (!response.ok) {
    const details = providerError(payload)
    const traceId = response.headers.get('x-siliconcloud-trace-id')?.trim()
    if (traceId) details.push(`traceId=${traceId.slice(0, 200)}`)
    throw new AiRuntimeError(
      'provider_http_error',
      `SiliconFlow transcription failed with HTTP ${response.status}${details.length ? `: ${details.join('; ')}` : ''}`
    )
  }
  const text = responseText(payload)
  if (!text) throw new AiRuntimeError('invalid_response', 'SiliconFlow transcription response has no text')
  return {
    text,
    providerMetadata: {
      response: payload,
      traceId: response.headers.get('x-siliconcloud-trace-id') ?? undefined,
    },
  }
}

async function formData(
  preset: SiliconFlowAsrPreset,
  input: SpeechRecognitionInput,
  maxFileBytes: number,
  context: Context
): Promise<FormData> {
  if (input.audio.kind === 'remote-url') {
    throw new AiRuntimeError('unsupported_media_source', 'SiliconFlow transcription requires uploaded audio bytes')
  }
  const media = await readCapabilityMediaSource(input.audio, context.runtime.media)
  if (media.bytes.byteLength === 0) throw new AiRuntimeError('invalid_media', 'SiliconFlow transcription audio is empty')
  if (media.bytes.byteLength > maxFileBytes) {
    throw new AiRuntimeError('media_too_large', `SiliconFlow transcription audio exceeds ${maxFileBytes} bytes`)
  }
  const uploadBytes = new Uint8Array(media.bytes.byteLength)
  uploadBytes.set(media.bytes)
  const form = new FormData()
  form.append('file', new Blob([uploadBytes], { type: media.mimeType }), media.filename)
  form.append('model', preset.modelId)
  return form
}

/** Create an on-demand SiliconFlow file transcription module. */
export function createSiliconFlowAsrModule(
  preset: SiliconFlowAsrPreset,
  moduleOptions: SiliconFlowAsrModuleOptions = {}
): SpeechRecognitionModule {
  const apiBaseUrl = endpoint(moduleOptions.apiBaseUrl)
  const maxFileBytes = moduleOptions.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  if (!Number.isFinite(maxFileBytes) || maxFileBytes <= 0) {
    throw new AiRuntimeError('invalid_parameter', 'SiliconFlow maxFileBytes must be positive')
  }
  return {
    descriptor: preset.descriptor,
    execute: async (input, context) => {
      if (context.signal.aborted) throw cancelledError(context.requestId)
      validateInput(input)
      const apiKey = await credential(context)
      const response = await context.runtime.transport.fetch(`${apiBaseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: await formData(preset, input, maxFileBytes, context),
        signal: context.signal,
      })
      const output = await parseResponse(response)
      await context.emit({ type: 'final', text: output.text })
      await context.emit({ type: 'completed', output })
      return output
    },
  }
}
