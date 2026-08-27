import type {
  SpeechRecognitionOutput,
  SpeechRecognitionSegment,
  SpeechRecognitionWord,
} from '..'
import { AiRuntimeError } from '../../../runtime/AiRuntimeError'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is UnknownRecord => item !== undefined) : []
}

function recordsOrOne(value: unknown): UnknownRecord[] {
  const many = records(value)
  if (many.length) return many
  const one = record(value)
  return one ? [one] : []
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseWord(value: UnknownRecord): SpeechRecognitionWord | undefined {
  const wordText = text(value.text)
  if (!wordText) return undefined
  return {
    text: `${wordText}${text(value.punctuation) ?? ''}`,
    startMs: numberValue(value.begin_time),
    endMs: numberValue(value.end_time),
  }
}

function parseSentence(value: UnknownRecord): SpeechRecognitionSegment | undefined {
  const sentenceText = text(value.text)
  if (!sentenceText) return undefined
  const words = records(value.words).map(parseWord).filter((word): word is SpeechRecognitionWord => word !== undefined)
  return {
    text: sentenceText,
    startMs: numberValue(value.begin_time),
    endMs: numberValue(value.end_time),
    ...(words.length ? { words } : {}),
  }
}

/** 解析 Fun-ASR 短音频 SSE，去重供应商可能回显的累计句子。 */
export function parseFunShortSse(payload: string): SpeechRecognitionOutput {
  const segments: SpeechRecognitionSegment[] = []
  let latestText = ''
  let durationMs: number | undefined
  for (const line of payload.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      throw new AiRuntimeError('invalid_response', 'Bailian Fun-ASR returned malformed SSE JSON')
    }
    const root = record(parsed)
    const output = record(root?.output)
    latestText = text(output?.text) ?? latestText
    const durationSeconds = numberValue(record(root?.usage)?.duration)
    if (durationSeconds !== undefined) durationMs = durationSeconds * 1_000
    for (const sentence of recordsOrOne(output?.sentence)) {
      if (sentence.sentence_end !== true) continue
      const segment = parseSentence(sentence)
      if (!segment) continue
      const duplicate = segments.find((candidate) =>
        candidate.startMs === segment.startMs
        && (candidate.text === segment.text
          || candidate.text.startsWith(segment.text)
          || segment.text.startsWith(candidate.text)))
      if (duplicate) {
        if (segment.text.length > duplicate.text.length) duplicate.text = segment.text
        duplicate.endMs = Math.max(duplicate.endMs ?? 0, segment.endMs ?? 0) || undefined
      } else {
        segments.push(segment)
      }
    }
  }
  const combined = segments.map((segment) => segment.text).join('').trim()
  const finalText = combined || latestText
  if (!finalText) throw new AiRuntimeError('invalid_response', 'Bailian Fun-ASR response has no transcript')
  return { text: finalText, durationMs, segments, providerMetadata: { protocol: 'fun-short-sse' } }
}

export function parseQwenShortResponse(payload: unknown): SpeechRecognitionOutput {
  const root = record(payload)
  const topChoice = records(root?.choices)[0]
  const dashChoice = records(record(root?.output)?.choices)[0]
  const choice = topChoice ?? dashChoice
  const rawContent = record(choice?.message)?.content
  const content = text(rawContent) ?? (Array.isArray(rawContent)
    ? rawContent.map((item) => text(item) ?? text(record(item)?.text) ?? '').join('').trim()
    : undefined)
  if (!content) throw new AiRuntimeError('invalid_response', 'Bailian Qwen ASR response has no transcript')
  return { text: content, providerMetadata: payload }
}

export interface BailianTaskState {
  taskId?: string
  status: string
  output?: UnknownRecord
  code?: string
  message?: string
}

export function parseTaskState(payload: unknown): BailianTaskState {
  const root = record(payload)
  const output = record(root?.output)
  const status = text(output?.task_status)
  if (!status) throw new AiRuntimeError('invalid_response', 'Bailian task response has no task_status')
  return {
    taskId: text(output?.task_id),
    status: status.toUpperCase(),
    output,
    code: text(root?.code) ?? text(output?.code),
    message: text(root?.message) ?? text(output?.message),
  }
}

export function transcriptionUrlFromTask(output: UnknownRecord): string {
  const results = [...records(output.results), ...recordsOrOne(output.result)]
  const succeeded = results.find((result) => {
    const status = text(result.subtask_status)?.toUpperCase()
    return status === undefined || status === 'SUCCEEDED'
  })
  const url = text(succeeded?.transcription_url)
  if (url) return validateResultUrl(url)
  const failed = results.find((result) => text(result.subtask_status)?.toUpperCase() === 'FAILED')
  if (failed) {
    throw new AiRuntimeError(
      'provider_task_failed',
      text(failed.message) ?? text(failed.code) ?? 'Bailian transcription subtask failed'
    )
  }
  throw new AiRuntimeError('invalid_response', 'Bailian task succeeded without transcription_url')
}

function validateResultUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch {
    throw new AiRuntimeError('invalid_response', 'Bailian transcription_url is invalid')
  }
  if (url.protocol !== 'https:') {
    throw new AiRuntimeError('invalid_response', 'Bailian transcription_url must use HTTPS')
  }
  return url.toString()
}

export function parseFileTranscript(payload: unknown): SpeechRecognitionOutput {
  const root = record(payload)
  const properties = record(root?.properties)
  const segments: SpeechRecognitionSegment[] = []
  const texts: string[] = []
  for (const transcript of records(root?.transcripts)) {
    const transcriptText = text(transcript.text)
    if (transcriptText) texts.push(transcriptText)
    segments.push(...records(transcript.sentences)
      .map(parseSentence)
      .filter((segment): segment is SpeechRecognitionSegment => segment !== undefined))
  }
  const combined = texts.join('\n').trim() || segments.map((segment) => segment.text).join('').trim()
  if (!combined) throw new AiRuntimeError('invalid_response', 'Bailian transcription result has no transcript')
  return {
    text: combined,
    durationMs: numberValue(properties?.original_duration_in_milliseconds),
    segments,
    providerMetadata: payload,
  }
}
