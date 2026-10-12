import { subtitleStyleOptionsSchema, resolveSubtitleStyle, subtitleWidth, subtitleFrameBoundary } from './subtitleStyleProfiles'
import { segmentTimedSubtitles, subtitleTokensFromCharacters, type SubtitlePause } from './subtitleSegmentation'
import type { AudioEditTranscriptBlock } from '../audioEdit/types'
import { joinAudioEditText } from '../audioEdit/captions'
import type { VideoEditRatio } from './time'
import type { VideoEditCaption } from './timedContent'

export const autoSubtitleOptionsSchema = subtitleStyleOptionsSchema
export type { SubtitleStyleOptions as AutoSubtitleOptions } from './subtitleStyleProfiles'
import type { SubtitleStyleOptions as AutoSubtitleOptions } from './subtitleStyleProfiles'
const subtitleWords = new Intl.Segmenter('zh', { granularity: 'word' })

const subtitlePunctuation = /^[，。；：、？！—…,.!?;:-]$/u
const subtitleLength = (text: string): number => Array.from(text).reduce((sum, char) => sum + (/[\p{Script=Latin}\p{N}]/u.test(char) ? .5 : 1), 0)
const spokenLength = (text: string): number => Array.from(text).filter(char => /[\p{L}\p{N}]/u.test(char)).length

/** Shared line boundaries: nearest punctuation, then word boundaries; never split an English word. */
export function wrapSubtitleText(text: string, maximum: number): string {
  if (!Number.isInteger(maximum) || maximum < 1) throw new Error('每行字数必须为正整数。')
  const lines: string[] = []
  for (const paragraph of text.split(/\r\n|[\r\n\u2028\u2029]/u)) {
    const normalized = paragraph.trim().replace(/[^\S\r\n]+/gu, ' ').replace(/([a-z0-9][,;:])(?=[a-z0-9])/gi, '$1 ')
    const tokens = Array.from(subtitleWords.segment(normalized), value => value.segment)
      .flatMap(token => /^[—…]+$/u.test(token) ? Array.from(token) : [token])
    // Prefix sums avoid repeatedly joining/scanning a long narration.
    const sizes = [0]; const spoken = [0]
    for (const token of tokens) { sizes.push(sizes.at(-1)! + subtitleLength(token)); spoken.push(spoken.at(-1)! + spokenLength(token)) }
    for (let begin = 0; begin < tokens.length;) {
      while (begin < tokens.length && /^\s+$/u.test(tokens[begin])) begin++
      if (begin === tokens.length) break
      let end = begin; let punctuation = -1
      while (end < tokens.length && sizes[end + 1] - sizes[begin] <= maximum) {
        if (subtitlePunctuation.test(tokens[end])) punctuation = end + 1
        end++
      }
      if (end < tokens.length) {
        if (punctuation > begin) {
          end = punctuation
          // Keep a dash/ellipsis run together, within the limit.
          while (end < tokens.length && tokens[end] === tokens[end - 1] && /^[—…]$/u.test(tokens[end]) && sizes[end + 1] - sizes[begin] <= maximum) end++
        } else {
          end = Math.max(begin + 1, end) // An indivisible overlong English word is allowed.
          if (spoken.at(-1)! - spoken[end] <= 2) {
            // A final 1–2 spoken-character tail may exceed the limit by at most two code points.
            if (sizes.at(-1)! - sizes[begin] <= maximum + 2) end = tokens.length
            else while (end > begin + 1 && spoken.at(-1)! - spoken[end] <= 2) end--
          }
        }
        // Closing punctuation belongs to its word, with the same two-character tolerance.
        while (end < tokens.length && subtitlePunctuation.test(tokens[end]) && sizes[end + 1] - sizes[begin] <= maximum + 2) end++
      }
      lines.push(tokens.slice(begin, end).join('').trim())
      begin = end
    }
  }
  return lines.join('\n')
}

export function audioTimestampToVideoFrame(sample: number, sampleRate: number, rate: VideoEditRatio): number {
  if (!Number.isFinite(sample) || sample < 0 || !Number.isFinite(sampleRate) || sampleRate <= 0 || rate.numerator <= 0 || rate.denominator <= 0) throw new Error('识别时间戳或帧率无效。')
  return subtitleFrameBoundary(sample * rate.numerator / (sampleRate * rate.denominator))
}

/** Wrapping retains word boundaries; punctuation is preferred to a full cue at the line limit. */
export function splitSubtitleText(text: string, maximum: number, maxLines: number): string[] {
  if (!Number.isInteger(maxLines) || maxLines < 1) throw new Error('每条字幕最多行数须为正整数。')
  const cues: string[] = []
  for (const paragraph of text.split(/\r\n|[\r\n\u2028\u2029]/u)) {
    const lines = wrapSubtitleText(paragraph, maximum).split('\n').filter(Boolean)
    let offset = 0
    while (offset < lines.length) {
      let count = Math.min(maxLines, lines.length - offset)
      if (lines.length - offset > maxLines) {
        const reversed = lines.slice(offset, offset + count).reverse().findIndex(line => /[，。！？；：、—…,.!?;:-]$/u.test(line))
        const pause = reversed < 0 ? -1 : count - reversed - 1
        if (pause >= 0) count = pause + 1
      }
      cues.push(lines.slice(offset, offset + count).join('\n'))
      offset += count
    }
  }
  return cues
}
const weight = (text: string): number => Array.from(text.replace(/\s/gu, '')).length

/** One second leaves time to acquire a cue. Merge if gaps cannot supply it; a shorter source range is the only exception. */
export function ensureSubtitleDuration<T extends { start: number; end: number; text: string }>(cues: readonly T[], minimum: number, range: { startFrame: number; endFrame: number }, merge: (left: T, right: T) => T): T[] {
  const result: T[] = []
  for (let index = 0; index < cues.length; index++) {
    let cue = { ...cues[index] }
    while (cue.end - cue.start < minimum && index + 1 < cues.length && cues[index + 1].start < cue.start + minimum) {
      cue = merge(cue, cues[++index])
    }
    cue.end = Math.min(range.endFrame, Math.max(cue.end, Math.min(cue.start + minimum, cues[index + 1]?.start ?? range.endFrame)))
    if (cue.end - cue.start < minimum) cue.start = Math.max(result.at(-1)?.end ?? range.startFrame, cue.end - minimum)
    if (cue.end - cue.start < minimum && result.length) {
      const previous = result.pop()!
      result.push(merge(previous, cue))
    } else result.push(cue)
  }
  return result
}

/** Word timestamps win at recognized boundaries; intra-word/segment splits are proportional estimates. */
export function buildAutoSubtitles(blocks: readonly AudioEditTranscriptBlock[], sampleRate: number, rate: VideoEditRatio, range: { startFrame: number; endFrame: number }, options: AutoSubtitleOptions = {}, pauses: readonly SubtitlePause[] = []): VideoEditCaption[] {
  const text = blocks.map(block => block.text).join('')
  const settings = resolveSubtitleStyle(options, text)
  if (settings.chinese) {
    audioTimestampToVideoFrame(0, sampleRate, rate)
    const fps = rate.numerator / rate.denominator
    const chars = [...blocks].sort((a, b) => a.startFrame - b.startFrame).filter(block => block.included).flatMap((block, wordId) => {
      if (block.endFrame <= block.startFrame) throw new Error('识别结果包含无效时间戳。')
      const points = Array.from(block.text)
      const end = block.granularity === 'segment' ? Math.min(block.endFrame, (range.endFrame - range.startFrame) / fps * sampleRate) : block.endFrame
      if ((end - block.startFrame) / sampleRate * fps < 1 && subtitleWidth(block.text) > settings.maxCharacters * settings.maxLines) throw new Error('字幕时长不足以拆分长句，请扩大声音范围。')
      return points.map((text, index) => ({ text, wordId: block.granularity === 'word' ? wordId : undefined,
        startMs: range.startFrame / fps * 1000 + (block.startFrame + (end - block.startFrame) * index / points.length) / sampleRate * 1000,
        endMs: range.startFrame / fps * 1000 + (block.startFrame + (end - block.startFrame) * (index + 1) / points.length) / sampleRate * 1000,
        timing: block.granularity === 'word' ? 'word' as const : 'estimated' as const }))
    })
    const tokens = subtitleTokensFromCharacters(chars)
    // Restore complete ASR word intervals (including trailing punctuation).
    const ordered = [...blocks].sort((a, b) => a.startFrame - b.startFrame).filter(block => block.included)
    for (const token of tokens) if (token.wordId !== undefined) {
      const block = ordered[token.wordId]
      token.startMs = Math.min(token.startMs, range.startFrame / fps * 1000 + block.startFrame / sampleRate * 1000)
      token.endMs = Math.max(token.endMs, range.startFrame / fps * 1000 + block.endFrame / sampleRate * 1000)
    }
    return segmentTimedSubtitles(tokens, { startMs: range.startFrame / fps * 1000, endMs: range.endFrame / fps * 1000 }, options, pauses).map(cue => {
      const start = Math.max(range.startFrame, subtitleFrameBoundary(cue.startMs * fps / 1000)); const end = Math.min(range.endFrame, subtitleFrameBoundary(cue.endMs * fps / 1000))
      if (end <= start) throw new Error('字幕时长不足一帧，请扩大声音范围。')
      return { id: crypto.randomUUID(), text: cue.text, start, duration: Math.max(1, end - start) }
    })
  }
  // English keeps the existing layout and timing policy until a separate profile is defined.
  const legacy = { ...settings, maxCharacters: options.maxCharacters ?? 24, minDurationSeconds: options.minDurationSeconds ?? 1, pauseSeconds: options.pauseSeconds ?? .6 }
  const groups: Array<{ text: string; start: number; end: number; word: boolean; blocks: AudioEditTranscriptBlock[] }> = []
  for (const block of [...blocks].sort((a, b) => a.startFrame - b.startFrame)) {
    if (!block.included || !block.text.trim()) continue
    if (!Number.isFinite(block.startFrame) || !Number.isFinite(block.endFrame) || block.endFrame <= block.startFrame) throw new Error('识别结果包含无效时间戳。')
    const previous = groups.at(-1); const text = block.text.trim()
    const joined = previous ? joinAudioEditText(previous.text, text) : text
    if (previous?.word && block.granularity === 'word' && !/[。！？.!?；;]$/.test(previous.text) && block.startFrame >= previous.end && block.startFrame - previous.end < sampleRate * legacy.pauseSeconds) {
      previous.text = joined; previous.end = block.endFrame; previous.blocks.push(block)
    } else groups.push({ text, start: block.startFrame, end: block.endFrame, word: block.granularity === 'word', blocks: [block] })
  }
  const converted = groups.flatMap(group => {
    const texts = splitSubtitleText(group.text, legacy.maxCharacters, legacy.maxLines)
    const frameAt = (sample: number): number => range.startFrame + audioTimestampToVideoFrame(sample, sampleRate, rate)
    const start = Math.max(range.startFrame, frameAt(group.start)); const end = Math.min(range.endFrame, frameAt(group.end))
    if (end <= start) return []
    if (end - start < texts.length) throw new Error('字幕时长不足以拆分长句，请增大每行字数或最多行数。')
    const total = weight(group.text)
    const sampleAt = (offset: number, edge: 'start' | 'end'): number => {
      if (!group.word) return group.start + (group.end - group.start) * offset / total
      let passed = 0
      for (const block of group.blocks) {
        const size = weight(block.text)
        if (offset < passed + size || offset === passed + size && edge === 'end') return block.startFrame + (block.endFrame - block.startFrame) * (offset - passed) / size
        passed += size
      }
      return group.end
    }
    let offset = 0; let previousEnd = start
    return texts.map((text, index) => {
      const from = index === 0 ? start : Math.max(previousEnd, Math.min(end - (texts.length - index), frameAt(sampleAt(offset, 'start'))))
      offset += weight(text)
      const to = index === texts.length - 1 ? end : Math.max(from + 1, Math.min(end - (texts.length - index - 1), frameAt(sampleAt(offset, 'end'))))
      previousEnd = to
      return { start: from, end: to, text }
    })
  })
  const minimum = Math.ceil(legacy.minDurationSeconds * rate.numerator / rate.denominator)
  return ensureSubtitleDuration(converted, minimum, range, (left, right) => ({ ...left, end: right.end, text: wrapSubtitleText(joinAudioEditText(left.text, right.text), legacy.maxCharacters) }))
    .map(group => ({ id: crypto.randomUUID(), start: group.start, duration: group.end - group.start, text: group.text }))
}
