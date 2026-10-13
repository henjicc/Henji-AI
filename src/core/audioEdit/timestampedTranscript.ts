import type { SpeechRecognitionOutput } from '@henjicc/ai-sdk'
import type { AsrWordGranularity } from './asrCatalog'
import type { AudioEditTranscriptBlock } from './types'

/** Preserve precise character/word tokens as editable word blocks; incomplete tokens retain their whole segment. */
export function audioEditTranscriptBlocks(output: TimestampedTranscript, sampleRate: number): AudioEditTranscriptBlock[] {
  const blocks: AudioEditTranscriptBlock[] = []
  for (const segment of output.segments) {
    const words = segment.words ?? []
    const precise = words.length > 0 && words.every(word => (word.granularity === 'word' || word.granularity === 'character') && word.timing === 'precise')
    for (const part of precise ? words : [segment]) {
      if (part.startMs === null || part.endMs === null) continue
      const startFrame = Math.round(part.startMs * sampleRate / 1000)
      const endFrame = Math.round(part.endMs * sampleRate / 1000)
      if (endFrame <= startFrame) continue
      blocks.push({ id: `transcript-${blocks.length}`, text: part.text, startFrame, endFrame, confidence: part.confidence, included: true, locked: false, granularity: precise ? 'word' : 'segment' })
    }
  }
  return blocks
}

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

/** SDK 时间戳的量化尾差最多容忍两个 20ms 量子；明显越界仍拒绝。 */
const TIMESTAMP_QUANTIZATION_TOLERANCE_MS = 40

/** 检验 SDK 毫秒 DTO，词按自身时间编辑，所属句仅作为文本分组。 */
export function normalizeTimestampedTranscript(
  output: SpeechRecognitionOutput,
  durationMs: number,
  wordGranularity: AsrWordGranularity,
): TimestampedTranscript {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('ASR_DURATION_INVALID')
  const range = (start: number | undefined, end: number | undefined): [number, number] | null => {
    for (const value of [start, end]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > durationMs + TIMESTAMP_QUANTIZATION_TOLERANCE_MS)) {
        throw new Error('ASR_TIMESTAMP_INVALID：识别结果时间超出录音范围。')
      }
    }
    if (start !== undefined && end !== undefined && end <= start) throw new Error('ASR_TIMESTAMP_INVALID：识别结果时间顺序无效。')
    if (start === undefined || end === undefined) return null
    const clippedStart = Math.min(start, durationMs)
    const clippedEnd = Math.min(end, durationMs)
    return clippedEnd > clippedStart ? [clippedStart, clippedEnd] : null
  }
  const words: TimestampedTranscriptPart[] = []
  const segments: TimestampedTranscript['segments'] = []
  for (const segment of output.segments ?? []) {
    const segmentRange = range(segment.startMs, segment.endMs)
    const segmentWords = (segment.words ?? []).map((word): TimestampedTranscriptPart => {
      const wordRange = range(word.startMs, word.endMs)
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
