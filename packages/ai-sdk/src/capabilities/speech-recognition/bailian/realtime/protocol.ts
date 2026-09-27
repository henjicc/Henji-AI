import { toBase64 } from '../../../../upload/base64'
import type {
  SpeechRecognitionRealtimeStart,
  SpeechRecognitionSegment,
} from '../..'
import { AiRuntimeError } from '../../../../runtime/AiRuntimeError'
import { parseBailianSentence } from '../parse'
import type { BailianRealtimeAsrPreset } from './presets'
import type { BailianRealtimeAsrOptions } from './types'

type UnknownRecord = Record<string, unknown>

export type BailianRealtimeEvent =
  | { kind: 'created'; sessionId?: string }
  | { kind: 'ready'; sessionId?: string }
  | { kind: 'partial'; text: string; segment?: SpeechRecognitionSegment }
  | { kind: 'final'; text: string; segment?: SpeechRecognitionSegment; durationMs?: number }
  | { kind: 'finished'; durationMs?: number }
  | { kind: 'error'; code?: string; message: string }
  | { kind: 'ignored'; eventType: string }
  | { kind: 'unknown'; eventType: string }

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function inputOptions(input: SpeechRecognitionRealtimeStart): BailianRealtimeAsrOptions {
  return input.options ?? {}
}

function languages(input: SpeechRecognitionRealtimeStart): string[] {
  return [...new Set([...(input.hints ?? []), ...(input.language ? [input.language] : [])]
    .map((item) => item.trim()).filter(Boolean))]
}

function formatFor(input: SpeechRecognitionRealtimeStart, options: BailianRealtimeAsrOptions): string {
  if (options.format) return options.format
  const formats: Record<string, string> = {
    'audio/pcm': 'pcm', 'audio/l16': 'pcm', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/opus': 'opus',
    'audio/aac': 'aac', 'audio/amr': 'amr',
  }
  const format = formats[input.mediaType.toLowerCase()]
  if (!format) throw new AiRuntimeError('unsupported_media_type', `Unsupported Bailian realtime media type: ${input.mediaType}`)
  return format
}

export function validateRealtimeStart(
  preset: BailianRealtimeAsrPreset,
  input: SpeechRecognitionRealtimeStart
): void {
  if (input.channels !== undefined && input.channels !== 1) {
    throw new AiRuntimeError('unsupported_audio_channels', 'Bailian realtime ASR requires mono audio')
  }
  const format = formatFor(input, inputOptions(input))
  if (preset.protocol === 'qwen-realtime' && format !== 'pcm' && format !== 'opus') {
    throw new AiRuntimeError('unsupported_media_type', 'Qwen realtime ASR only supports pcm or opus')
  }
  const sampleRate = input.sampleRateHz ?? 16_000
  if (preset.protocol === 'qwen-realtime' && sampleRate !== 8_000 && sampleRate !== 16_000) {
    throw new AiRuntimeError('unsupported_sample_rate', 'Qwen realtime ASR only supports 8000 or 16000 Hz')
  }
}

export function buildFunStart(
  preset: BailianRealtimeAsrPreset,
  input: SpeechRecognitionRealtimeStart,
  taskId: string
): string {
  const options = inputOptions(input)
  const parameters: Record<string, unknown> = {
    format: formatFor(input, options),
    sample_rate: input.sampleRateHz ?? 16_000,
    max_sentence_silence: options.maxSentenceSilenceMs ?? 1_300,
  }
  const hints = languages(input)
  if (hints.length) parameters.language_hints = hints
  if (options.vocabularyId?.trim()) parameters.vocabulary_id = options.vocabularyId.trim()
  if (options.semanticPunctuationEnabled) parameters.semantic_punctuation_enabled = true
  else if (options.multiThresholdModeEnabled) parameters.multi_threshold_mode_enabled = true
  if (options.heartbeat) parameters.heartbeat = true
  if (options.speechNoiseThreshold !== undefined) parameters.speech_noise_threshold = options.speechNoiseThreshold
  if (preset.modelId === 'qwen-audio-3.1-asr-flash-streaming') {
    if (options.keepDialect !== undefined) parameters.keep_dialect = options.keepDialect
    if (options.vadModel !== undefined) parameters.vad_model = options.vadModel
    if (options.vocabulary !== undefined) parameters.vocabulary = options.vocabulary
  }
  return JSON.stringify({
    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio', task: 'asr', function: 'recognition', model: preset.modelId,
      parameters, input: {},
    },
  })
}

export function buildFunFinish(taskId: string): string {
  return JSON.stringify({
    header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: {} },
  })
}

export function buildQwenUpdate(input: SpeechRecognitionRealtimeStart): string {
  const options = inputOptions(input)
  const turnDetection = options.turnDetection ?? 'server_vad'
  const session: Record<string, unknown> = {
    modalities: ['text'],
    input_audio_format: formatFor(input, options),
    sample_rate: input.sampleRateHz ?? 16_000,
    turn_detection: turnDetection === 'manual' ? null : {
      type: 'server_vad',
      threshold: options.vadThreshold ?? 0,
      silence_duration_ms: options.vadSilenceDurationMs ?? options.maxSentenceSilenceMs ?? 1_300,
    },
  }
  const language = languages(input)[0]
  if (language) session.input_audio_transcription = { language }
  return JSON.stringify({ type: 'session.update', session })
}

export function buildQwenAudio(bytes: Uint8Array): string {
  const audio = toBase64(bytes)
  if (audio.length > 15 * 1024 * 1024) {
    throw new AiRuntimeError('media_too_large', 'Qwen realtime audio chunk exceeds 15 MiB after Base64 encoding')
  }
  return JSON.stringify({ type: 'input_audio_buffer.append', audio })
}

export function qwenUsesManualCommit(input: SpeechRecognitionRealtimeStart): boolean {
  return inputOptions(input).turnDetection === 'manual'
}

export function parseRealtimeMessage(
  preset: BailianRealtimeAsrPreset,
  payload: string
): BailianRealtimeEvent {
  let eventType: string | undefined
  try {
    let parsed: unknown
    try { parsed = JSON.parse(payload) } catch {
      throw new AiRuntimeError('invalid_response', 'Server returned invalid JSON')
    }
    const root = record(parsed)
    if (!root) throw new AiRuntimeError('invalid_response', 'Server returned a non-object event')
    const discriminator = preset.protocol === 'fun-duplex' ? record(root.header)?.event : root.type
    if (typeof discriminator !== 'string' || !discriminator.trim()) {
      throw new AiRuntimeError('invalid_response', 'Server event has no event type')
    }
    eventType = /^[a-zA-Z][\w.-]{0,127}$/.test(discriminator) ? discriminator : 'unrecognized-event'
    return preset.protocol === 'fun-duplex' ? parseFunEvent(root) : parseQwenEvent(root)
  } catch (error) {
    if (!(error instanceof AiRuntimeError)) throw error
    throw new AiRuntimeError(error.code, `${preset.modelId} (${preset.protocol}): ${error.message.replace(`[${error.code}] `, '')}`, {
      providerId: 'bailian', modelId: preset.modelId, protocol: preset.protocol,
      stage: 'parse', eventType,
    })
  }
}

function parseFunEvent(root: UnknownRecord): BailianRealtimeEvent {
  const header = record(root.header)
  const eventType = string(header?.event) ?? ''
  if (eventType === 'task-started') return { kind: 'ready', sessionId: string(header?.task_id) }
  if (eventType === 'task-finished') {
    const duration = number((record(root.usage) ?? record(record(root.payload)?.usage))?.duration)
    return { kind: 'finished', durationMs: duration === undefined ? undefined : duration * 1_000 }
  }
  if (eventType === 'task-failed') {
    return {
      kind: 'error', code: string(header?.error_code),
      message: string(header?.error_message) ?? 'Bailian Fun-ASR realtime task failed',
    }
  }
  if (eventType === 'result-generated') {
    const sentence = record(record(record(root.payload)?.output)?.sentence)
    if (sentence?.heartbeat === true) return { kind: 'ignored', eventType: 'heartbeat' }
    if (typeof sentence?.text !== 'string' || typeof sentence.sentence_end !== 'boolean') {
      throw new AiRuntimeError('invalid_response', 'Result requires text and boolean sentence_end')
    }
    const segment = parseBailianSentence(sentence)
    const transcript = segment?.text ?? string(sentence?.text)
    if (!transcript) {
      // 句首及后续中间帧均可能尚无文字；只有首帧带 sentence_begin。
      // 必须有 text 字符串与明确的非终态，不能把缺字段的异常响应当作空帧。
      if (typeof sentence?.text === 'string' && sentence.sentence_end === false) {
        return { kind: 'ignored', eventType: sentence.sentence_begin === true ? 'empty-sentence-begin' : 'empty-intermediate' }
      }
      if (sentence?.sentence_end === true) {
        throw new AiRuntimeError('invalid_response', 'Final result has no text')
      }
      throw new AiRuntimeError('invalid_response', 'Result has no text or sentence state')
    }
    const duration = number((record(root.usage) ?? record(record(root.payload)?.usage))?.duration)
    return sentence?.sentence_end === true
      ? { kind: 'final', text: transcript, segment, durationMs: duration === undefined ? undefined : duration * 1_000 }
      : { kind: 'partial', text: transcript, segment }
  }
  return { kind: 'unknown', eventType: /^[a-zA-Z][\w.-]{0,127}$/.test(eventType) ? eventType : 'unrecognized-event' }
}

function parseQwenEvent(root: UnknownRecord): BailianRealtimeEvent {
  const eventType = string(root.type) ?? ''
  if (eventType === 'session.created') {
    return { kind: 'created', sessionId: string(record(root.session)?.id) ?? string(root.session_id) }
  }
  if (eventType === 'session.updated') {
    return { kind: 'ready', sessionId: string(record(root.session)?.id) ?? string(root.session_id) }
  }
  if (eventType === 'conversation.item.input_audio_transcription.text') {
    if (typeof root.text !== 'string' || typeof root.stash !== 'string') {
      throw new AiRuntimeError('invalid_response', 'Partial event requires string text and stash')
    }
    const transcript = root.text + root.stash
    if (!transcript.trim()) throw new AiRuntimeError('invalid_response', 'Bailian Qwen realtime partial event has no text')
    return { kind: 'partial', text: transcript }
  }
  if (eventType === 'conversation.item.input_audio_transcription.completed') {
    const transcript = string(root.transcript)
    if (!transcript) throw new AiRuntimeError('invalid_response', 'Bailian Qwen realtime final event has no transcript')
    return { kind: 'final', text: transcript }
  }
  if (eventType === 'session.finished') return { kind: 'finished' }
  if (eventType === 'input_audio_buffer.speech_started' || eventType === 'input_audio_buffer.speech_stopped') {
    const timestamp = root[eventType.endsWith('speech_started') ? 'audio_start_ms' : 'audio_end_ms']
    if (!string(root.item_id) || typeof timestamp !== 'number' || !Number.isInteger(timestamp) || timestamp < 0) {
      throw new AiRuntimeError('invalid_response', 'Invalid speech activity notification')
    }
    return { kind: 'ignored', eventType }
  }
  if (eventType === 'input_audio_buffer.committed') {
    if (!string(root.item_id)) throw new AiRuntimeError('invalid_response', 'Commit notification has no item_id')
    return { kind: 'ignored', eventType }
  }
  if (eventType === 'conversation.item.created') {
    const item = record(root.item)
    if (!string(item?.id) || !Array.isArray(item?.content)
      || !item.content.some(value => record(value)?.type === 'input_audio' && record(value)?.transcript === null)) {
      throw new AiRuntimeError('invalid_response', 'Invalid audio item notification')
    }
    return { kind: 'ignored', eventType }
  }
  if (eventType === 'error' || eventType === 'conversation.item.input_audio_transcription.failed') {
    const error = record(root.error)
    return {
      kind: 'error', code: string(error?.code) ?? string(root.code),
      message: string(error?.message) ?? string(root.message) ?? 'Bailian Qwen realtime task failed',
    }
  }
  return { kind: 'unknown', eventType: /^[a-zA-Z][\w.-]{0,127}$/.test(eventType) ? eventType : 'unrecognized-event' }
}
