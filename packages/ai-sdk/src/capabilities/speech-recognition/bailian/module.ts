import { toDataUri } from '../../../upload/base64'
import { AiRuntimeError, cancelledError } from '../../../runtime/AiRuntimeError'
import { readCapabilityMediaSource } from '../../media'
import type { CapabilityExecutionContext } from '../../types'
import type {
  SpeechRecognitionEvent,
  SpeechRecognitionInput,
  SpeechRecognitionModule,
  SpeechRecognitionOutput,
} from '..'
import {
  parseFileTranscript,
  parseFunShortSse,
  parseQwenShortResponse,
  parseTaskState,
  transcriptionUrlFromTask,
} from './parse'
import type { BailianAsrPreset } from './presets'
import type { BailianAsrModuleOptions, BailianAsrOptions } from './types'
import { resolveAsyncAudioUrl } from './upload'

type Context = CapabilityExecutionContext<SpeechRecognitionEvent>

const DEFAULT_API_BASE = 'https://dashscope.aliyuncs.com/api/v1'
const DEFAULT_COMPATIBLE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

function base(value: string | undefined, fallback: string): string {
  const normalized = (value?.trim() || fallback).replace(/\/+$/, '')
  let parsed: URL
  try { parsed = new URL(normalized) } catch {
    throw new AiRuntimeError('invalid_endpoint', `Bailian endpoint is invalid: ${normalized}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AiRuntimeError('invalid_endpoint', 'Bailian endpoint must use HTTP(S)')
  }
  return normalized
}

function providerOptions(input: SpeechRecognitionInput): BailianAsrOptions {
  return input.options ?? {}
}

async function credential(context: Context): Promise<string> {
  const apiKey = (await context.runtime.credentials.get('speech-recognition', 'bailian'))?.trim()
  if (!apiKey) throw new AiRuntimeError('api_key_missing', 'Bailian speech-recognition API key is not configured')
  return apiKey
}

async function responseJson(response: Response, operation: string): Promise<unknown> {
  const body = await response.text()
  if (!response.ok) {
    throw new AiRuntimeError('provider_http_error', `Bailian ${operation} failed with HTTP ${response.status}`)
  }
  try { return JSON.parse(body) } catch {
    throw new AiRuntimeError('invalid_response', `Bailian ${operation} returned invalid JSON`)
  }
}

function checkAbort(context: Context): void {
  if (context.signal.aborted) throw cancelledError(context.requestId)
}

async function inlineAudio(input: SpeechRecognitionInput, preset: BailianAsrPreset, context: Context): Promise<string> {
  if (input.audio.kind === 'remote-url') {
    let url: URL
    try { url = new URL(input.audio.url) } catch {
      throw new AiRuntimeError('invalid_media_url', 'Bailian short ASR media URL is invalid')
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new AiRuntimeError('invalid_media_url', 'Bailian short ASR media URL must use HTTP(S)')
    }
    return url.toString()
  }
  const media = await readCapabilityMediaSource(input.audio, context.runtime.media)
  if (preset.maxInlineBytes !== undefined && media.bytes.byteLength > preset.maxInlineBytes) {
    throw new AiRuntimeError('media_too_large', `Bailian ${preset.modelId} inline audio exceeds ${preset.maxInlineBytes} bytes`)
  }
  return toDataUri(media.bytes, media.mimeType)
}

function formatFrom(input: SpeechRecognitionInput, options: BailianAsrOptions): string {
  if (options.format?.trim()) return options.format.trim()
  const mediaType = input.audio.mediaType?.toLowerCase()
  const filename = input.audio.kind === 'media-ref' ? undefined : input.audio.filename
  const extension = filename?.split('.').pop()?.toLowerCase()
  const byMime: Record<string, string> = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/ogg': 'ogg', 'audio/flac': 'flac',
    'video/mp4': 'mp4', 'video/webm': 'webm',
  }
  return (mediaType && byMime[mediaType]) || extension || 'wav'
}

async function executeFunShort(
  preset: BailianAsrPreset, input: SpeechRecognitionInput, apiKey: string, apiBaseUrl: string, context: Context
): Promise<SpeechRecognitionOutput> {
  const options = providerOptions(input)
  const content: Array<Record<string, unknown>> = []
  if (options.context?.trim()) content.push({ type: 'text', text: options.context.trim() })
  content.push({ type: 'input_audio', input_audio: { data: await inlineAudio(input, preset, context) } })
  const parameters: Record<string, unknown> = { format: formatFrom(input, options) }
  if (options.sampleRateHz !== undefined) parameters.sample_rate = options.sampleRateHz
  if (options.vocabularyId) parameters.vocabulary_id = options.vocabularyId
  const languageHints = [...new Set([...(input.hints ?? []), ...(input.language ? [input.language] : [])]
    .map((hint) => hint.trim()).filter(Boolean))]
  if (languageHints.length) parameters.language_hints = languageHints
  const response = await context.runtime.transport.fetch(`${apiBaseUrl}/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-SSE': 'enable',
    },
    body: JSON.stringify({ model: preset.modelId, input: { messages: [{ role: 'user', content }] }, parameters }),
    signal: context.signal,
  })
  if (!response.ok) throw new AiRuntimeError('provider_http_error', `Bailian Fun-ASR failed with HTTP ${response.status}`)
  const output = parseFunShortSse(await response.text())
  for (const segment of output.segments ?? []) await context.emit({ type: 'final', text: segment.text, segment })
  await context.emit({ type: 'completed', output })
  return output
}

async function executeQwenShort(
  preset: BailianAsrPreset, input: SpeechRecognitionInput, apiKey: string, compatibleBaseUrl: string, context: Context
): Promise<SpeechRecognitionOutput> {
  const options = providerOptions(input)
  const response = await context.runtime.transport.fetch(`${compatibleBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: preset.modelId,
      messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: await inlineAudio(input, preset, context) } }] }],
      asr_options: {
        ...(input.language ? { language: input.language } : {}),
        ...(options.enableItn !== undefined ? { enable_itn: options.enableItn } : {}),
      },
    }),
    signal: context.signal,
  })
  const output = parseQwenShortResponse(await responseJson(response, 'Qwen short ASR'))
  await context.emit({ type: 'final', text: output.text })
  await context.emit({ type: 'completed', output })
  return output
}

function asyncParameters(
  preset: BailianAsrPreset, input: SpeechRecognitionInput, options: BailianAsrOptions
): Record<string, unknown> {
  const languages = [...new Set([...(input.hints ?? []), ...(input.language ? [input.language] : [])]
    .map((hint) => hint.trim()).filter(Boolean))]
  if (preset.asyncInputField === 'file_url') {
    return {
      ...(languages.length === 1 ? { language: languages[0] } : {}),
      enable_words: input.timestamps ?? true,
      enable_itn: options.enableItn ?? false,
      ...(options.channelId !== undefined ? { channel_id: options.channelId } : {}),
    }
  }
  return {
    ...(languages.length ? { language_hints: languages } : {}),
    ...(options.vocabularyId ? { vocabulary_id: options.vocabularyId } : {}),
    ...(options.diarizationEnabled !== undefined ? { diarization_enabled: options.diarizationEnabled } : {}),
    ...(options.speakerCount !== undefined ? { speaker_count: options.speakerCount } : {}),
    ...(options.channelId !== undefined ? { channel_id: options.channelId } : {}),
    ...(options.specialWordFilter ? { special_word_filter: options.specialWordFilter } : {}),
  }
}

async function wait(ms: number, context: Context): Promise<void> {
  checkAbort(context)
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

async function executeFile(
  preset: BailianAsrPreset,
  input: SpeechRecognitionInput,
  apiKey: string,
  apiBaseUrl: string,
  uploadBaseUrl: string,
  config: Required<Pick<BailianAsrModuleOptions, 'pollIntervalMs' | 'maxPollingMs'>>,
  context: Context
): Promise<SpeechRecognitionOutput> {
  const audio = await resolveAsyncAudioUrl(input.audio, preset.modelId, apiKey, uploadBaseUrl, context)
  const asyncInput = preset.asyncInputField === 'file_urls' ? { file_urls: [audio.url] } : { file_url: audio.url }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable',
  }
  if (audio.usesOss) headers['X-DashScope-OssResourceResolve'] = 'enable'
  const submitResponse = await context.runtime.transport.fetch(`${apiBaseUrl}/services/audio/asr/transcription`, {
    method: 'POST', headers,
    body: JSON.stringify({ model: preset.modelId, input: asyncInput, parameters: asyncParameters(preset, input, providerOptions(input)) }),
    signal: context.signal,
  })
  const submitted = parseTaskState(await responseJson(submitResponse, 'file ASR submit'))
  const taskId = submitted.taskId
  if (!taskId) throw new AiRuntimeError('invalid_response', 'Bailian file ASR submit response has no task_id')
  await context.emit({ type: 'started', sessionId: taskId })
  const startedAt = Date.now()
  let state = submitted
  while (state.status === 'PENDING' || state.status === 'RUNNING') {
    if (Date.now() - startedAt >= config.maxPollingMs) {
      throw new AiRuntimeError('timeout', `Bailian file ASR polling timed out: ${taskId}`)
    }
    await context.emit({ type: 'processing', taskId, status: state.status })
    await wait(config.pollIntervalMs, context)
    const response = await context.runtime.transport.fetch(`${apiBaseUrl}/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: context.signal,
    })
    state = parseTaskState(await responseJson(response, 'file ASR polling'))
  }
  if (state.status !== 'SUCCEEDED' || !state.output) {
    throw new AiRuntimeError('provider_task_failed', state.message ?? state.code ?? `Bailian task ended as ${state.status}`)
  }
  const resultUrl = transcriptionUrlFromTask(state.output)
  const resultResponse = await context.runtime.transport.fetch(resultUrl, { signal: context.signal })
  const output = parseFileTranscript(await responseJson(resultResponse, 'transcription result'))
  for (const segment of output.segments ?? []) await context.emit({ type: 'final', text: segment.text, segment })
  await context.emit({ type: 'completed', output })
  return output
}

/** 创建一个百炼非实时 ASR 模块；只导入本子路径时才会带入供应商实现。 */
export function createBailianAsrModule(
  preset: BailianAsrPreset,
  options: BailianAsrModuleOptions = {}
): SpeechRecognitionModule {
  const apiBaseUrl = base(options.apiBaseUrl, DEFAULT_API_BASE)
  const compatibleBaseUrl = base(options.compatibleBaseUrl, DEFAULT_COMPATIBLE_BASE)
  const uploadBaseUrl = base(options.uploadBaseUrl, DEFAULT_API_BASE)
  const polling = {
    pollIntervalMs: options.pollIntervalMs ?? 2_000,
    maxPollingMs: options.maxPollingMs ?? 30 * 60_000,
  }
  return {
    descriptor: preset.descriptor,
    execute: async (input, context) => {
      checkAbort(context)
      const apiKey = await credential(context)
      if (preset.protocol === 'fun-short-sse') {
        return await executeFunShort(preset, input, apiKey, apiBaseUrl, context)
      }
      if (preset.protocol === 'qwen-short') {
        return await executeQwenShort(preset, input, apiKey, compatibleBaseUrl, context)
      }
      return await executeFile(preset, input, apiKey, apiBaseUrl, uploadBaseUrl, polling, context)
    },
  }
}
