import { speechTimingsSchema, type SpeechTimings } from './speechTimings'

export interface AlignedSpeechCharacter { text: string; startMs: number; endMs: number; confidence: number; estimated: boolean; startExact?: boolean; endExact?: boolean; mismatch?: boolean; wordId?: number; wordStartMs?: number; wordEndMs?: number }

/** Linear-space LCS (Hirschberg). Yields regularly; no narration-length/product quota. */
export async function alignSpeechTimings(original: string, input: SpeechTimings, signal?: AbortSignal): Promise<AlignedSpeechCharacter[]> {
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
  const matches = new Map<number, number>()
  let work = 0
  async function checkpoint(count: number): Promise<void> {
    signal?.throwIfAborted(); work += count
    if (work >= 65536) { work = 0; await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted() }
  }
  async function row(a: number, b: number, c: number, d: number, reverse: boolean): Promise<Uint32Array> {
    let previous = new Uint32Array(d - c + 1); let next = new Uint32Array(d - c + 1)
    for (let i = 0; i < b - a; i++) {
      next[0] = 0
      for (let j = 1; j <= d - c; j++) next[j] = target[reverse ? b - i - 1 : a + i] === recognized[reverse ? d - j : c + j - 1].text ? previous[j - 1] + 1 : Math.max(previous[j], next[j - 1])
      ;[previous, next] = [next, previous]
      await checkpoint(d - c)
    }
    return previous
  }
  async function match(a: number, b: number, c: number, d: number): Promise<void> {
    // Exact prefixes/suffixes make the common native-timestamp path linear.
    while (a < b && c < d && target[a] === recognized[c].text) { matches.set(a++, c++); await checkpoint(1) }
    while (a < b && c < d && target[b - 1] === recognized[d - 1].text) { matches.set(--b, --d); await checkpoint(1) }
    if (a === b || c === d) return
    if (b - a === 1) {
      for (let j = c; j < d; j++) if (target[a] === recognized[j].text) { matches.set(a, j); break }
      return
    }
    const middle = Math.floor((a + b) / 2)
    // Release row buffers before descending; otherwise an unbalanced split retains them at every level.
    const split = await (async () => {
      const left = await row(a, middle, c, d, false); const right = await row(middle, b, c, d, true)
      let best = 0
      for (let j = 1; j <= d - c; j++) if (left[j] + right[d - c - j] > left[best] + right[d - c - best]) best = j
      return best
    })()
    await match(a, middle, c, c + split); await match(middle, b, c + split, d)
  }
  await match(0, target.length, 0, recognized.length)
  const result: AlignedSpeechCharacter[] = target.map((text, index) => {
    const matched = matches.get(index)
    return matched === undefined ? { text, startMs: 0, endMs: 0, confidence: 0, estimated: true, mismatch: !/\s/u.test(text) } : { ...recognized[matched], text }
  })
  // Deleted recognition text also weakens alignment, including leading/trailing deletions.
  let previous = -1; let previousTarget: number | undefined
  for (const [targetIndex, recognizedIndex] of [...matches].sort(([a], [b]) => a - b)) {
    if (recognized.slice(previous + 1, recognizedIndex).some(char => !/\s/u.test(char.text))) {
      result[targetIndex].mismatch = true
      if (previousTarget !== undefined) result[previousTarget].mismatch = true
    }
    previous = recognizedIndex; previousTarget = targetIndex
  }
  if (previousTarget !== undefined && recognized.slice(previous + 1).some(char => !/\s/u.test(char.text))) result[previousTarget].mismatch = true
  for (let i = 0; i < result.length;) {
    if (matches.has(i)) { i++; continue }
    const begin = i; while (i < result.length && !matches.has(i)) i++
    const from = begin ? result[begin - 1].endMs : recognized[0].startMs
    const next = i < result.length ? result[i].startMs : recognized[recognized.length - 1].endMs
    const leftMatch = begin ? matches.get(begin - 1) ?? -1 : -1
    const rightMatch = matches.get(i) ?? recognized.length
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
