import { AiRuntimeError, cancelledError } from '../../../runtime/AiRuntimeError'
import type { CapabilityExecutionContext } from '../../types'
import type {
  SpeechRecognitionEvent,
  SpeechRecognitionInput,
  SpeechRecognitionModule,
  SpeechRecognitionOutput,
} from '..'
import { parseVolcengineFileTranscript } from './parse'
import type { VolcengineAsrPreset } from './presets'
import { volcengineRequestId } from './request-id'
import type { VolcengineAsrModuleOptions, VolcengineAsrOptions } from './types'

type Context = CapabilityExecutionContext<SpeechRecognitionEvent>

const DEFAULT_API_BASE = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel'
const RESOURCE_ID = 'volc.seedasr.auc'
const SUCCESS = '20000000'
const PROCESSING = new Set(['20000001', '20000002'])
const AUDIO_FORMATS = new Set(['raw', 'wav', 'mp3', 'ogg'])

function endpoint(value: string | undefined): string {
  const normalized = (value?.trim() || DEFAULT_API_BASE).replace(/\/+$/, '')
  let parsed: URL
  try { parsed = new URL(normalized) } catch {
    throw new AiRuntimeError('invalid_endpoint', 'Volcengine file ASR endpoint is invalid')
  }
  if (parsed.protocol !== 'https:') {
    throw new AiRuntimeError('invalid_endpoint', 'Volcengine file ASR endpoint must use HTTPS')
  }
  return parsed.toString().replace(/\/+$/, '')
}

function options(input: SpeechRecognitionInput): VolcengineAsrOptions {
  const raw = input.options
  if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw))) {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine file ASR options must be an object')
  }
  const provider = (raw ?? {}) as Record<string, unknown>
  if (provider.format !== undefined && typeof provider.format !== 'string') {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine file ASR options.format must be a string')
  }
  for (const key of ['enableItn', 'enableDdc', 'showUtterances'] as const) {
    if (provider[key] !== undefined && typeof provider[key] !== 'boolean') {
      throw new AiRuntimeError('invalid_parameter', `Volcengine file ASR options.${key} must be boolean`)
    }
  }
  return provider as VolcengineAsrOptions
}

function validateRemoteAudio(input: SpeechRecognitionInput): URL {
  if (input.audio.kind !== 'remote-url') {
    throw new AiRuntimeError(
      'unsupported_media_source',
      'Volcengine SeedASR 2.0 file transcription requires a provider-readable remote URL; upload local audio first'
    )
  }
  if (typeof input.audio.url !== 'string') {
    throw new AiRuntimeError('invalid_media_url', 'Volcengine file ASR media URL must be a string')
  }
  let url: URL
  try { url = new URL(input.audio.url) } catch {
    throw new AiRuntimeError('invalid_media_url', 'Volcengine file ASR media URL is invalid')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AiRuntimeError('invalid_media_url', 'Volcengine file ASR media URL must use HTTP(S)')
  }
  if (input.hints !== undefined && (!Array.isArray(input.hints)
    || input.hints.some((hint) => typeof hint !== 'string'))) {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine file ASR hints must be strings')
  }
  if (input.hints?.some((hint) => hint.trim())) {
    throw new AiRuntimeError('unsupported_parameter', 'Volcengine SeedASR 2.0 file P0 does not support hints')
  }
  return url
}

function audioFormat(input: SpeechRecognitionInput, provider: VolcengineAsrOptions, url: URL): string {
  const explicit = provider.format?.trim().toLowerCase()
  if (explicit) {
    if (!AUDIO_FORMATS.has(explicit)) {
      throw new AiRuntimeError(
        'unsupported_audio_format',
        'Volcengine SeedASR 2.0 file format must be raw, wav, mp3, or ogg'
      )
    }
    return explicit
  }
  const byMime: Record<string, string> = {
    'audio/l16': 'raw',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/pcm': 'raw',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
  }
  const rawMediaType = input.audio.mediaType
  if (rawMediaType !== undefined && typeof rawMediaType !== 'string') {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine file ASR mediaType must be a string')
  }
  const mediaType = rawMediaType?.toLowerCase().split(';', 1)[0]
  if (mediaType && byMime[mediaType]) return byMime[mediaType]
  const rawFilename = input.audio.kind === 'remote-url' ? input.audio.filename : undefined
  if (rawFilename !== undefined && typeof rawFilename !== 'string') {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine file ASR filename must be a string')
  }
  const filename = rawFilename?.trim() || url.pathname
  const extension = filename.split('.').pop()?.toLowerCase()
  const inferred = extension === 'pcm' ? 'raw' : extension
  if (inferred && AUDIO_FORMATS.has(inferred)) return inferred
  if (extension && /^[a-z0-9]{2,8}$/.test(extension)) {
    throw new AiRuntimeError(
      'unsupported_audio_format',
      'Volcengine SeedASR 2.0 file format must be raw, wav, mp3, or ogg'
    )
  }
  throw new AiRuntimeError(
    'invalid_parameter',
    'Volcengine file ASR audio.format cannot be inferred; provide options.format'
  )
}

async function apiKey(context: Context): Promise<string> {
  const value = (await context.runtime.credentials.get('speech-recognition', 'volcengine'))?.trim()
  if (!value) {
    throw new AiRuntimeError('api_key_missing', 'Volcengine speech-recognition API key is not configured')
  }
  return value
}

function status(response: Response, operation: string): { code: string; message?: string; logId?: string } {
  if (!response.ok) {
    throw new AiRuntimeError('provider_http_error', `Volcengine ${operation} failed with HTTP ${response.status}`)
  }
  const code = response.headers.get('X-Api-Status-Code')?.trim()
  if (!code) {
    throw new AiRuntimeError('invalid_response', `Volcengine ${operation} response has no X-Api-Status-Code`)
  }
  const message = response.headers.get('X-Api-Message')?.trim() || undefined
  const logId = response.headers.get('X-Tt-Logid')?.trim() || undefined
  return { code, message, logId }
}

async function json(response: Response): Promise<unknown> {
  const body = await response.text()
  try { return JSON.parse(body) } catch {
    throw new AiRuntimeError('invalid_response', 'Volcengine file ASR query returned invalid JSON')
  }
}

function checkAbort(context: Context): void {
  if (context.signal.aborted) throw cancelledError(context.requestId)
}

async function wait(ms: number, context: Context): Promise<void> {
  checkAbort(context)
  if (ms === 0) return
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timeout)
      reject(cancelledError(context.requestId))
    }
    const timeout = setTimeout(() => {
      context.signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    context.signal.addEventListener('abort', onAbort, { once: true })
  })
}

function submitBody(input: SpeechRecognitionInput, requestId: string, remote: URL): Record<string, unknown> {
  const provider = options(input)
  if (input.language !== undefined && typeof input.language !== 'string') {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine file ASR language must be a string')
  }
  if (input.punctuation !== undefined && typeof input.punctuation !== 'boolean') {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine file ASR punctuation must be boolean')
  }
  if (input.timestamps !== undefined && typeof input.timestamps !== 'boolean') {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine file ASR timestamps must be boolean')
  }
  return {
    user: { uid: requestId },
    audio: {
      url: remote.toString(),
      format: audioFormat(input, provider, remote),
      ...(input.language?.trim() ? { language: input.language.trim() } : {}),
    },
    request: {
      model_name: 'bigmodel',
      enable_itn: provider.enableItn ?? true,
      enable_punc: input.punctuation ?? true,
      enable_ddc: provider.enableDdc ?? false,
      show_utterances: provider.showUtterances ?? input.timestamps ?? true,
    },
  }
}

/** 创建火山 SeedASR 2.0 录音文件识别 submit/query 模块。 */
export function createVolcengineAsrModule(
  preset: VolcengineAsrPreset,
  moduleOptions: VolcengineAsrModuleOptions = {}
): SpeechRecognitionModule {
  const apiBaseUrl = endpoint(moduleOptions.apiBaseUrl)
  const pollIntervalMs = moduleOptions.pollIntervalMs ?? 1_000
  const maxPollingMs = moduleOptions.maxPollingMs ?? 30 * 60_000
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine pollIntervalMs must be non-negative')
  }
  if (!Number.isFinite(maxPollingMs) || maxPollingMs <= 0) {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine maxPollingMs must be positive')
  }
  return {
    descriptor: preset.descriptor,
    execute: async (input, context): Promise<SpeechRecognitionOutput> => {
      checkAbort(context)
      const remote = validateRemoteAudio(input)
      const credential = await apiKey(context)
      checkAbort(context)
      const taskId = volcengineRequestId(context.requestId, moduleOptions.requestIdFactory)
      const commonHeaders = {
        'Content-Type': 'application/json',
        'X-Api-Key': credential,
        'X-Api-Resource-Id': RESOURCE_ID,
        'X-Api-Request-Id': taskId,
      }
      const submitted = await context.runtime.transport.fetch(`${apiBaseUrl}/submit`, {
        method: 'POST',
        headers: { ...commonHeaders, 'X-Api-Sequence': '-1' },
        body: JSON.stringify(submitBody(input, taskId, remote)),
        signal: context.signal,
      })
      checkAbort(context)
      const submitStatus = status(submitted, 'file ASR submit')
      if (submitStatus.code !== SUCCESS) {
        throw new AiRuntimeError(
          'provider_task_failed',
          `Volcengine file ASR submit failed (${submitStatus.code})${submitStatus.message ? `: ${submitStatus.message}` : ''}`
        )
      }
      await context.emit({ type: 'started', sessionId: taskId })
      const startedAt = Date.now()
      let logId = submitStatus.logId
      while (!context.signal.aborted) {
        checkAbort(context)
        const queried = await context.runtime.transport.fetch(`${apiBaseUrl}/query`, {
          method: 'POST',
          headers: {
            ...commonHeaders,
            ...(logId ? { 'X-Tt-Logid': logId } : {}),
          },
          body: '{}',
          signal: context.signal,
        })
        checkAbort(context)
        const queryStatus = status(queried, 'file ASR query')
        logId = queryStatus.logId ?? logId
        if (queryStatus.code === SUCCESS) {
          const output = parseVolcengineFileTranscript(await json(queried), { taskId, logId })
          if (output.segments?.length) {
            for (const segment of output.segments) {
              await context.emit({ type: 'final', text: segment.text, segment })
            }
          } else {
            await context.emit({ type: 'final', text: output.text })
          }
          await context.emit({ type: 'completed', output })
          return output
        }
        if (!PROCESSING.has(queryStatus.code)) {
          throw new AiRuntimeError(
            'provider_task_failed',
            `Volcengine file ASR task failed (${queryStatus.code})${queryStatus.message ? `: ${queryStatus.message}` : ''}`
          )
        }
        await context.emit({
          type: 'processing',
          taskId,
          status: queryStatus.code === '20000002' ? 'QUEUED' : 'PROCESSING',
        })
        if (Date.now() - startedAt >= maxPollingMs) {
          throw new AiRuntimeError('timeout', `Volcengine file ASR polling timed out: ${taskId}`)
        }
        await wait(pollIntervalMs, context)
      }
      throw cancelledError(context.requestId)
    },
  }
}
