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
  return Array.isArray(value)
    ? value.map(record).filter((item): item is UnknownRecord => item !== undefined)
    : []
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function milliseconds(value: unknown): number | undefined {
  const seconds = numberValue(value)
  return seconds === undefined ? undefined : seconds * 1_000
}

function parseWord(value: UnknownRecord): SpeechRecognitionWord | undefined {
  const wordText = text(value.word) ?? text(value.text)
  if (!wordText) return undefined
  return {
    text: wordText,
    startMs: milliseconds(value.start),
    endMs: milliseconds(value.end),
  }
}

function parseSegment(value: UnknownRecord): SpeechRecognitionSegment | undefined {
  const segmentText = text(value.text)
  if (!segmentText) return undefined
  const words = records(value.words)
    .map(parseWord)
    .filter((word): word is SpeechRecognitionWord => word !== undefined)
  return {
    text: segmentText,
    startMs: milliseconds(value.start),
    endMs: milliseconds(value.end),
    ...(words.length ? { words } : {}),
  }
}

function closestSegmentIndex(
  word: SpeechRecognitionWord,
  segments: readonly SpeechRecognitionSegment[]
): number {
  if (segments.length <= 1) return 0
  const anchor = word.startMs !== undefined && word.endMs !== undefined
    ? (word.startMs + word.endMs) / 2
    : word.startMs ?? word.endMs
  if (anchor === undefined) return 0
  let closestIndex = 0
  let closestDistance = Number.POSITIVE_INFINITY
  for (const [index, segment] of segments.entries()) {
    const start = segment.startMs ?? Number.NEGATIVE_INFINITY
    const end = segment.endMs ?? Number.POSITIVE_INFINITY
    if (anchor >= start && anchor <= end) return index
    const distance = anchor < start ? start - anchor : anchor - end
    if (distance < closestDistance) {
      closestIndex = index
      closestDistance = distance
    }
  }
  return closestIndex
}

function attachTopLevelWords(
  segments: readonly SpeechRecognitionSegment[],
  words: readonly SpeechRecognitionWord[]
): SpeechRecognitionSegment[] {
  if (!segments.length || !words.length) return [...segments]
  const grouped = segments.map(() => [] as SpeechRecognitionWord[])
  for (const word of words) grouped[closestSegmentIndex(word, segments)]?.push(word)
  return segments.map((segment, index) => (
    segment.words?.length || !grouped[index]?.length
      ? segment
      : { ...segment, words: grouped[index] }
  ))
}

/** Parse Groq JSON and verbose_json transcription responses into the portable ASR contract. */
export function parseGroqTranscription(payload: unknown): SpeechRecognitionOutput {
  const root = record(payload)
  const transcript = text(root?.text)
  if (!transcript) throw new AiRuntimeError('invalid_response', 'Groq transcription response has no text')
  let segments = records(root?.segments)
    .map(parseSegment)
    .filter((segment): segment is SpeechRecognitionSegment => segment !== undefined)
  const topLevelWords = records(root?.words)
    .map(parseWord)
    .filter((word): word is SpeechRecognitionWord => word !== undefined)
  if (segments.length && topLevelWords.length) {
    segments = attachTopLevelWords(segments, topLevelWords)
  } else if (topLevelWords.length) {
    segments.push({
      text: transcript,
      startMs: topLevelWords[0]?.startMs,
      endMs: topLevelWords[topLevelWords.length - 1]?.endMs,
      words: topLevelWords,
    })
  }
  return {
    text: transcript,
    language: text(root?.language),
    durationMs: milliseconds(root?.duration),
    ...(segments.length ? { segments } : {}),
    providerMetadata: payload,
  }
}
