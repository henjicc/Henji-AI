import type { SpeechRecognitionOutput } from '@henjicc/ai-sdk'
import type { AsrWordGranularity } from './asrCatalog'

export interface TimestampedTranscriptPart {
  text: string
  startMs: number | null
  endMs: number | null
  confidence?: number
  granularity: AsrWordGranularity | 'segment' | 'none'
  timing: 'precise' | 'coarse' | 'missing'
}

export interface TimestampedTranscript {
  text: string
  unit: 'ms'
  words: TimestampedTranscriptPart[]
  segments: Array<TimestampedTranscriptPart & { words?: TimestampedTranscriptPart[] }>
  granularity: AsrWordGranularity | 'segment' | 'mixed' | 'none'
}

/** 检验 SDK 的毫秒 DTO，不解析供应商响应、不均分句子、不夹断非法时间。 */
export function normalizeTimestampedTranscript(
  output: SpeechRecognitionOutput,
  durationMs: number,
  wordGranularity: AsrWordGranularity,
): TimestampedTranscript {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('ASR_DURATION_INVALID')
  const range = (start: number | undefined, end: number | undefined): [number, number] | null => {
    for (const value of [start, end]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > durationMs)) {
        throw new Error('ASR_TIMESTAMP_INVALID：识别结果时间超出录音范围。')
      }
    }
    if (start !== undefined && end !== undefined && end <= start) throw new Error('ASR_TIMESTAMP_INVALID：识别结果时间顺序无效。')
    return start === undefined || end === undefined ? null : [start, end]
  }
  const words: TimestampedTranscriptPart[] = []
  const segments: TimestampedTranscript['segments'] = []
  for (const segment of output.segments ?? []) {
    const segmentRange = range(segment.startMs, segment.endMs)
    const segmentWords = (segment.words ?? []).map((word): TimestampedTranscriptPart => {
      const wordRange = range(word.startMs, word.endMs)
      if (wordRange && segmentRange && (wordRange[0] < segmentRange[0] || wordRange[1] > segmentRange[1])) {
        throw new Error('ASR_TIMESTAMP_INVALID：词时间超出所属句子。')
      }
      return {
        text: word.text, startMs: wordRange?.[0] ?? null, endMs: wordRange?.[1] ?? null,
        confidence: word.confidence, granularity: wordRange ? wordGranularity : 'none',
        timing: wordRange ? 'precise' : 'missing',
      }
    })
    for (const word of segmentWords) words.push(word)
    segments.push({
      text: segment.text, startMs: segmentRange?.[0] ?? null, endMs: segmentRange?.[1] ?? null,
      confidence: segment.confidence, granularity: segmentRange ? 'segment' : 'none',
      timing: segmentRange ? 'coarse' : 'missing',
      words: segmentWords,
    })
  }
  if (!segments.length && output.text) segments.push({ text: output.text, startMs: null, endMs: null, granularity: 'none', timing: 'missing' })
  const hasWords = words.some((word) => word.timing === 'precise')
  const coarseOrMissing = words.some((word) => word.timing === 'missing')
    || segments.some((segment, index) => !(output.segments?.[index]?.words?.length))
  return {
    text: output.text, unit: 'ms', words, segments,
    granularity: hasWords ? (coarseOrMissing ? 'mixed' : wordGranularity)
      : segments.some((segment) => segment.timing === 'coarse') ? 'segment' : 'none',
  }
}
