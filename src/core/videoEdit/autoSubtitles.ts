import { z } from 'zod'
import type { AudioEditTranscriptBlock } from '../audioEdit/types'
import { joinAudioEditText } from '../audioEdit/captions'
import type { VideoEditRatio } from './time'
import type { VideoEditCaption } from './timedContent'

export const autoSubtitleOptionsSchema = z.object({
  maxCharacters: z.number().int().min(4).max(80).default(24),
  maxLines: z.number().int().min(1).default(2).describe('每条字幕最多行数，超出时拆成多条。'),
  pauseSeconds: z.number().min(.1).max(2).default(.6).describe('词间停顿达到此秒数时开始下一条字幕。'),
  minDurationSeconds: z.number().min(0).max(5).default(1),
}).strict()
export type AutoSubtitleOptions = z.input<typeof autoSubtitleOptionsSchema>
const subtitleWords = new Intl.Segmenter('en', { granularity: 'word' })

/** Preserve English words where possible; split a single overlong token by Unicode code points. */
export function wrapSubtitleText(text: string, maximum: number): string {
  if (!Number.isInteger(maximum) || maximum < 1) throw new Error('每行字数必须为正整数。')
  const tokens = Array.from(subtitleWords.segment(text.trim()), value => value.segment).flatMap(token => /\p{Script=Han}/u.test(token) ? Array.from(token) : [token])
  const lines: string[] = []; let line = ''
  const flush = (): void => { if (line.trim()) lines.push(line.trim()); line = '' }
  for (const token of tokens) {
    if (/[\r\n]/.test(token)) { flush(); continue }
    if (/[a-z0-9][,;:]$/i.test(line) && /^[a-z0-9]/i.test(token)) line += ' '
    // CJK has no lexical spaces; the code-point fallback supplies its natural line boundaries.
    const parts = Array.from(token).length > maximum ? Array.from(token) : [token]
    for (const part of parts) {
      if (Array.from(line + part).length > maximum) {
        if (line && /^[，。！？；、,.!?;]$/.test(part) && maximum > 1) {
          const points = Array.from(line); const last = points.pop()!
          line = points.join(''); flush(); line = last
        } else flush()
      }
      if (!line && /^\s+$/.test(part)) continue
      line += part
      if (/[，。！？；、,.!?;]$/.test(part) && Array.from(line).length >= Math.ceil(maximum * .65)) flush()
    }
  }
  flush(); return lines.join('\n')
}

export function audioTimestampToVideoFrame(sample: number, sampleRate: number, rate: VideoEditRatio): number {
  if (!Number.isFinite(sample) || sample < 0 || !Number.isFinite(sampleRate) || sampleRate <= 0 || rate.numerator <= 0 || rate.denominator <= 0) throw new Error('识别时间戳或帧率无效。')
  return Math.round(sample * rate.numerator / (sampleRate * rate.denominator))
}

/** Wrapping retains word boundaries; punctuation is preferred to a full cue at the line limit. */
export function splitSubtitleText(text: string, maximum: number, maxLines: number): string[] {
  if (!Number.isInteger(maxLines) || maxLines < 1) throw new Error('每条字幕最多行数须为正整数。')
  const lines = wrapSubtitleText(text, maximum).split('\n').filter(Boolean)
  const cues: string[] = []
  while (lines.length) {
    let count = Math.min(maxLines, lines.length)
    if (lines.length > maxLines) {
      const reversed = lines.slice(0, count).reverse().findIndex(line => /[，。！？；、,.!?;:]$/.test(line))
      const pause = reversed < 0 ? -1 : count - reversed - 1
      if (pause >= 0) count = pause + 1
    }
    cues.push(lines.splice(0, count).join('\n'))
  }
  return cues
}
const weight = (text: string): number => Array.from(text.replace(/\s/gu, '')).length

/** Word timestamps win at recognized boundaries; intra-word/segment splits are proportional estimates. */
export function buildAutoSubtitles(blocks: readonly AudioEditTranscriptBlock[], sampleRate: number, rate: VideoEditRatio, range: { startFrame: number; endFrame: number }, options: AutoSubtitleOptions = {}): VideoEditCaption[] {
  const settings = autoSubtitleOptionsSchema.parse(options)
  const groups: Array<{ text: string; start: number; end: number; word: boolean; blocks: AudioEditTranscriptBlock[] }> = []
  for (const block of [...blocks].sort((a, b) => a.startFrame - b.startFrame)) {
    if (!block.included || !block.text.trim()) continue
    if (!Number.isFinite(block.startFrame) || !Number.isFinite(block.endFrame) || block.endFrame <= block.startFrame) throw new Error('识别结果包含无效时间戳。')
    const previous = groups.at(-1); const text = block.text.trim()
    const joined = previous ? joinAudioEditText(previous.text, text) : text
    if (previous?.word && block.granularity === 'word' && !/[。！？.!?；;]$/.test(previous.text) && block.startFrame >= previous.end && block.startFrame - previous.end < sampleRate * settings.pauseSeconds) {
      previous.text = joined; previous.end = block.endFrame; previous.blocks.push(block)
    } else groups.push({ text, start: block.startFrame, end: block.endFrame, word: block.granularity === 'word', blocks: [block] })
  }
  const converted = groups.flatMap(group => {
    const texts = splitSubtitleText(group.text, settings.maxCharacters, settings.maxLines)
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
  const minimum = Math.round(settings.minDurationSeconds * rate.numerator / rate.denominator)
  return converted.flatMap((group, index) => {
    const start = Math.max(range.startFrame, group.start)
    const next = converted[index + 1]?.start ?? range.endFrame
    // Extend a short cue only into an actual gap; speech in the next cue always wins.
    const end = Math.min(range.endFrame, Math.max(group.end, Math.min(start + minimum, next)))
    return end > start ? [{ id: crypto.randomUUID(), start, duration: end - start, text: group.text }] : []
  })
}
