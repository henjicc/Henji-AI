import diffSequences from '@jest/diff-sequences'
import { speechTimingsSchema, type SpeechTimings } from './speechTimings'

export interface AlignedSpeechCharacter { text: string; startMs: number; endMs: number; confidence: number; estimated: boolean; startExact?: boolean; endExact?: boolean; mismatch?: boolean; wordId?: number; wordStartMs?: number; wordEndMs?: number }

/** Exact, linear-space LCS kernel. Unbounded application inputs run in the subtitle Worker. */
export async function alignSpeechTimings(original: string, input: SpeechTimings, signal?: AbortSignal): Promise<AlignedSpeechCharacter[]> {
  signal?.throwIfAborted()
  const timings = speechTimingsSchema.parse(input)
  const target = Array.from(original)
  const recognized = timings.items.flatMap((item, wordId) => {
    const chars = Array.from(item.text)
    const estimated = timings.granularity === 'sentence' || chars.filter(char => /[\p{L}\p{N}]/u.test(char)).length > 1
    return chars.map((text, index) => ({ text, ...(timings.granularity === 'word' ? { wordId, wordStartMs: item.startMs, wordEndMs: item.endMs } : {}), startMs: item.startMs + (item.endMs - item.startMs) * index / chars.length,
      endMs: item.startMs + (item.endMs - item.startMs) * (index + 1) / chars.length, confidence: item.confidence ?? 1,
      estimated, startExact: timings.granularity !== 'sentence' && index === 0,
      endExact: timings.granularity !== 'sentence' && index === chars.length - 1 }))
  })
  if (!recognized.length) throw new Error('没有可用于对齐的时间戳。')
  const matches = new Int32Array(target.length).fill(-1)
  // Removing symbols absent from the other sequence preserves the exact LCS. Keep full
  // positions for timestamps/mismatch evidence; never prune by guessed anchors or bands.
  const targetAlphabet = new Set(target), recognizedAlphabet = new Set(recognized.map(char => char.text))
  const targetPositions = target.flatMap((text, index) => recognizedAlphabet.has(text) ? [index] : [])
  const recognizedPositions = recognized.flatMap((char, index) => targetAlphabet.has(char.text) ? [index] : [])
  diffSequences(targetPositions.length, recognizedPositions.length,
    (a, b) => target[targetPositions[a]] === recognized[recognizedPositions[b]].text,
    (count, a, b) => { for (let i = 0; i < count; i++) matches[targetPositions[a + i]] = recognizedPositions[b + i] })
  const result: AlignedSpeechCharacter[] = target.map((text, index) => {
    const matched = matches[index]
    return matched < 0 ? { text, startMs: 0, endMs: 0, confidence: 0, estimated: true, mismatch: !/\s/u.test(text) } : { ...recognized[matched], text }
  })
  // Deleted recognition text also weakens alignment, including leading/trailing deletions.
  let previous = -1; let previousTarget: number | undefined
  for (let targetIndex = 0; targetIndex < matches.length; targetIndex++) {
    const recognizedIndex = matches[targetIndex]
    if (recognizedIndex < 0) continue
    if (recognized.slice(previous + 1, recognizedIndex).some(char => /[\p{L}\p{N}]/u.test(char.text))) {
      result[targetIndex].mismatch = true
      if (previousTarget !== undefined) result[previousTarget].mismatch = true
    }
    previous = recognizedIndex; previousTarget = targetIndex
  }
  if (previousTarget !== undefined && recognized.slice(previous + 1).some(char => /[\p{L}\p{N}]/u.test(char.text))) result[previousTarget].mismatch = true
  for (let i = 0; i < result.length;) {
    if (matches[i] >= 0) { i++; continue }
    const begin = i; while (i < result.length && matches[i] < 0) i++
    const from = begin ? result[begin - 1].endMs : recognized[0].startMs
    const next = i < result.length ? result[i].startMs : recognized[recognized.length - 1].endMs
    const leftMatch = begin ? matches[begin - 1] : -1
    const rightMatch = i < matches.length ? matches[i] : recognized.length
    const unmatched = recognized.slice(leftMatch + 1, rightMatch)
    // Recognition insertions are not time available for interpolating original text.
    // A same-length lexical replacement may use its own interval; other missing text is unanchored.
    const replacement = unmatched.length === i - begin && unmatched.every(char => /[\p{L}\p{N}]/u.test(char.text))
    const insertion = unmatched.some(char => /[\p{L}\p{N}]/u.test(char.text)) && !replacement
    const to = Math.max(from, insertion ? from : next)
    for (let j = begin; j < i; j++) result[j] = { ...result[j], startMs: from + (to - from) * (j - begin) / (i - begin), endMs: from + (to - from) * (j - begin + 1) / (i - begin) }
  }
  signal?.throwIfAborted()
  return result
}
