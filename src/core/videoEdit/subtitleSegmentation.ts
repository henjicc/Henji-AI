import { adaptiveSubtitlePause, normalizeSubtitlePunctuation, resolveSubtitleStyle, subtitleWidth, type SubtitleStyleOptions } from './subtitleStyleProfiles'

export interface SubtitleToken { text: string; startMs: number; endMs: number; wordId?: number; timing?: 'word' | 'estimated' }
export interface SubtitlePause { startMs: number; endMs: number }
export interface SegmentedSubtitle { text: string; sourceText: string; startMs: number; endMs: number; first: number; last: number }
const words = new Intl.Segmenter('zh', { granularity: 'word' })
const sentenceEnd = /[。？！!?…]\s*$/u
const clauseEnd = /[；;]\s*$/u
const punctuationEnd = /[，,；;：:—、]\s*$/u
const conjunction = /^(?:但|而|所以|因为|如果|然后|再|还|并且|以及|和|与|把|被|给|在|对|从|向|为了)/u

/** ICU word segmentation is also used for native character timings and cue-only estimates. */
export function subtitleTokensFromCharacters(chars: readonly SubtitleToken[]): SubtitleToken[] {
  const text = chars.map(char => char.text).join('')
  const result: SubtitleToken[] = []
  let offset = 0
  for (const part of words.segment(text)) {
    const count = Array.from(part.segment).length
    const selected = chars.slice(offset, offset + count); offset += count
    if (!selected.length) continue
    const spoken = selected.filter(char => /[\p{L}\p{N}]/u.test(char.text))
    const first = spoken[0] ?? selected[0]; const last = spoken.at(-1) ?? selected.at(-1)!
    const previous = result.at(-1)
    if (!spoken.length && previous) { previous.text += part.segment; continue }
    if (!spoken.length) continue
    // Never split an ASR word even if ICU has a finer boundary.
    if (previous && first.wordId !== undefined && previous.wordId === first.wordId) {
      previous.text += part.segment; previous.endMs = Math.max(previous.endMs, last.endMs); previous.wordId = last.wordId
    } else result.push({ text: part.segment, startMs: first.startMs, endMs: last.endMs, wordId: last.wordId, timing: selected.some(char => char.timing === 'estimated') ? 'estimated' : 'word' })
  }
  return result
}

/** Format only at safe word boundaries; punctuation/connector boundaries win over balance. */
export function wrapStyledSubtitle(text: string, options: SubtitleStyleOptions = {}): string {
  const settings = resolveSubtitleStyle(options, text)
  const policy = settings.chinese ? settings.punctuation : 'preserve'
  const normalized = normalizeSubtitlePunctuation(text.replace(/\s+/gu, ' '), policy)
  if (subtitleWidth(normalized) <= settings.maxCharacters) return normalized
  // In mixed Chinese text a Latin name/phrase is one layout unit, including its spaces.
  const latinPhrase = /^[A-Za-z]+(?: +[A-Za-z]+)+$/u
  const tokens = (settings.chinese ? normalized.split(/([A-Za-z]+(?: +[A-Za-z]+)+)/u) : [normalized])
    .flatMap(part => settings.chinese && latinPhrase.test(part) ? [part] : Array.from(words.segment(part), value => value.segment))
  const lines: string[] = []
  for (let start = 0; start < tokens.length;) {
    let end = start; let preferred = -1; let preferredScore = Infinity
    let width = 0
    while (end < tokens.length && width + subtitleWidth(tokens[end]) <= settings.maxCharacters) {
      width += subtitleWidth(tokens[end]); end++
      const score = /\s|[？！…]$/u.test(tokens[end - 1]) ? 0 : conjunction.test(tokens[end] ?? '') ? 1 : /、$/u.test(tokens[end - 1]) ? 2 : Infinity
      if (width >= settings.maxCharacters / 3 && score < Infinity && score <= preferredScore) { preferred = end; preferredScore = score }
    }
    if (end === start) end++ // An indivisible word is a real technical constraint, never truncate it.
    else if (end < tokens.length && preferred > start) end = preferred
    // The profile drops enumeration punctuation at a line end; never move it to the next line's start.
    lines.push(normalizeSubtitlePunctuation(tokens.slice(start, end).join(''), policy))
    start = end
  }
  return lines.filter(Boolean).join('\n').replace(/、(?=\n|$)/gu, '')
}

/**
 * All clocks here are milliseconds. Meaningful sentence/semicolon groups are joined only as
 * a minimum-duration fallback. Within a group, choose readable word boundaries using pause evidence.
 * Impossible speed/duration constraints preserve speech instead of clipping words or dropping text.
 */
export function segmentTimedSubtitles(input: readonly SubtitleToken[], range: { startMs: number; endMs: number }, options: SubtitleStyleOptions = {}, pauses: readonly SubtitlePause[] = []): SegmentedSubtitle[] {
  const tokens = input.filter(token => token.text.trim() && token.endMs >= range.startMs && token.startMs < range.endMs).map(token => ({ ...token }))
  if (!tokens.length) return []
  const energyGaps = new Map<number, number>()
  for (const pause of pauses) {
    const midpoint = (pause.startMs + pause.endMs) / 2
    let low = 1; let high = tokens.length
    while (low < high) { const middle = (low + high) >>> 1; if (tokens[middle].startMs < midpoint) low = middle + 1; else high = middle }
    let best = -1; let distance = Infinity
    for (const boundary of [low - 2, low - 1]) {
      const left = tokens[boundary]; const right = tokens[boundary + 1]
      if (!left || !right || pause.startMs < left.startMs || pause.endMs > right.endMs) continue
      const exact = left.timing === 'word' || right.timing === 'word'
      if (exact && (pause.startMs < left.endMs - 1 || pause.endMs > right.startMs + 1)) continue
      const delta = Math.abs(midpoint - (left.endMs + right.startMs) / 2)
      if (delta < distance) { best = boundary; distance = delta }
    }
    if (best < 0) continue
    const left = tokens[best]; const right = tokens[best + 1]
    // Energy refines estimated clocks only; a detected silence must never override an ASR word.
    if (left.timing !== 'word' && right.timing !== 'word') { left.endMs = pause.startMs; right.startMs = pause.endMs }
    energyGaps.set(best, Math.max(energyGaps.get(best) ?? 0, pause.endMs - pause.startMs))
  }
  const settings = resolveSubtitleStyle(options, tokens.map(token => token.text).join(''))
  const gaps = tokens.slice(1).map((token, index) => Math.max(0, token.startMs - tokens[index].endMs))
  const threshold = adaptiveSubtitlePause([...gaps, ...pauses.map(pause => pause.endMs - pause.startMs)], settings.pauseSeconds)
  const policy = settings.chinese ? settings.punctuation : 'preserve'
  const minimum = settings.minDurationSeconds * 1000
  const maximum = settings.maxDurationSeconds * 1000
  const boundaries = tokens.map((token, index) => {
    const next = tokens[index + 1]
    const gap = next ? Math.max(0, next.startMs - token.endMs) : 0
    const energy = energyGaps.get(index) ?? 0
    const observed = Math.max(gap, energy)
    // Word clocks can disprove punctuation; estimates cannot.
    const liaison = next && token.timing === 'word' && next.timing === 'word' && observed < Math.min(threshold / 4, 60)
    return { gap: observed, sentence: (sentenceEnd.test(token.text) || /\n\s*$/u.test(token.text)) && !liaison, clause: clauseEnd.test(token.text) && !liaison,
      score: liaison ? 100 : sentenceEnd.test(token.text) ? 0 : clauseEnd.test(token.text) ? 1 : observed >= threshold ? 2 / (1 + observed / threshold) : punctuationEnd.test(token.text) ? 5 : conjunction.test(next?.text ?? '') ? 8 : 16 }
  })
  const result: SegmentedSubtitle[] = []
  const widths = [0]
  for (const token of tokens) widths.push(widths.at(-1)! + subtitleWidth(normalizeSubtitlePunctuation(token.text, policy)))
  const textOf = (first: number, last: number): string => tokens.slice(first, last + 1).map(token => token.text).join('').trim()
  function emit(first: number, last: number): void {
    const startMs = Math.max(range.startMs, tokens[first].startMs)
    const speechEnd = Math.min(range.endMs, tokens[last].endMs)
    const nextStart = Math.min(range.endMs, tokens[last + 1]?.startMs ?? range.endMs)
    const text = wrapStyledSubtitle(textOf(first, last), options)
    const reading = subtitleWidth(text) / settings.maxReadingSpeed * 1000
    const endMs = Math.max(speechEnd, Math.min(nextStart, startMs + maximum, Math.max(speechEnd, startMs + minimum, startMs + reading)))
    result.push({ text, sourceText: textOf(first, last), startMs, endMs, first, last })
  }
  function split(first: number, last: number): void {
    const text = textOf(first, last)
    const width = subtitleWidth(normalizeSubtitlePunctuation(text, policy))
    const following = tokens[last + 1]?.startMs
    const connectedEnd = following !== undefined && following >= tokens[last].endMs && following - tokens[last].endMs < settings.joinGapMs ? following : tokens[last].endMs
    const duration = connectedEnd - tokens[first].startMs
    if (first === last) { emit(first, last); return }
    if ((tokens[last + 1]?.startMs ?? range.endMs) - tokens[first].startMs < minimum * 2) { emit(first, last); return }
    const over = width > settings.maxCharacters * settings.maxLines || duration > maximum || wrapStyledSubtitle(text, options).split('\n').length > settings.maxLines
    let best = -1; let bestCost = Infinity
    for (let index = first; index < last; index++) {
      if (settings.chinese && /[A-Za-z]\s*$/u.test(tokens[index].text) && /^\s*[A-Za-z]/u.test(tokens[index + 1].text)) continue
      const leftMs = tokens[index + 1].startMs - tokens[first].startMs
      const rightMs = (tokens[last + 1]?.startMs ?? range.endMs) - tokens[index + 1].startMs
      if (!over && (leftMs < minimum || rightMs < minimum)) continue
      const boundary = boundaries[index]
      const strongPause = (boundary.gap >= threshold || energyGaps.has(index)) && boundary.score < 100
      // A fitting meaning group may use both lines; enumeration punctuation alone is not a cue break.
      if (!over && !(width > settings.maxCharacters && strongPause && !/、\s*$/u.test(tokens[index].text))) continue
      const leftWidth = widths[index + 1] - widths[first]
      const rightWidth = width - leftWidth
      const readingPenalty = Math.max(0, leftWidth / Math.max(.001, leftMs / 1000) - settings.maxReadingSpeed)
        + Math.max(0, rightWidth / Math.max(.001, rightMs / 1000) - settings.maxReadingSpeed)
      const cost = boundary.score * 10 + Math.max(0, minimum - leftMs) + Math.max(0, minimum - rightMs) + readingPenalty * 20 + Math.abs(leftWidth - rightWidth) / 10
      if (cost < bestCost) { best = index; bestCost = cost }
    }
    if (best < 0) emit(first, last)
    else { split(first, best); split(best + 1, last) }
  }
  let first = 0
  for (let index = 0; index < tokens.length; index++) {
    if (index === tokens.length - 1 || boundaries[index].sentence || boundaries[index].clause) {
      split(first, index); first = index + 1
    }
  }
  // Try same-group neighbors first; crossing a sentence is a last resort for an unreadably short cue.
  for (let index = 0; index < result.length; index++) {
    const cue = result[index]
    if (cue.endMs - cue.startMs >= minimum) continue
    const previous = result[index - 1]; const next = result[index + 1]
    const candidates = [previous ? [previous, cue] : [], next ? [cue, next] : []]
      .filter((pair): pair is [SegmentedSubtitle, SegmentedSubtitle] => pair.length === 2)
      .sort(([leftA], [leftB]) => Number(boundaries[leftA.last].sentence || boundaries[leftA.last].clause) - Number(boundaries[leftB.last].sentence || boundaries[leftB.last].clause))
    for (const [left, right] of candidates) {
      const text = wrapStyledSubtitle(textOf(left.first, right.last), options)
      if (text.split('\n').length > settings.maxLines || right.endMs - left.startMs > maximum || right.startMs - left.endMs >= settings.joinGapMs) continue
      const at = left === cue ? index : index - 1
      result.splice(at, 2, { ...left, text, sourceText: textOf(left.first, right.last), last: right.last, endMs: right.endMs }); index = Math.max(-1, at - 1)
      break
    }
  }
  for (let index = 0; index + 1 < result.length; index++) {
    const current = result[index]; const next = result[index + 1]
    const gap = next.startMs - current.endMs
    if (gap >= 0 && gap < settings.joinGapMs) current.endMs = next.startMs
  }
  return result.filter(cue => cue.text && cue.endMs > cue.startMs)
}
