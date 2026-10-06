import { z } from 'zod'
import type { AudioEditTranscriptBlock } from '../audioEdit/types'
import { joinAudioEditText } from '../audioEdit/captions'
import type { VideoEditRatio } from './time'
import type { VideoEditCaption } from './timedContent'

export const autoSubtitleOptionsSchema = z.object({
  maxCharacters: z.number().int().min(4).max(80).default(24),
  minDurationSeconds: z.number().min(0).max(5).default(1),
}).strict()
export type AutoSubtitleOptions = z.input<typeof autoSubtitleOptionsSchema>

/** Preserve English words where possible; split a single overlong token by Unicode code points. */
export function wrapSubtitleText(text: string, maximum: number): string {
  if (!Number.isInteger(maximum) || maximum < 1) throw new Error('每行字数必须为正整数。')
  const tokens = text.trim().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\p{L}\p{N}]/gu) ?? []
  const lines: string[] = []; let line = ''
  const flush = (): void => { if (line.trim()) lines.push(line.trim()); line = '' }
  for (const token of tokens) {
    if (token === '\n') { flush(); continue }
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

/** Never subdivide a segment timestamp: only word boundaries may create additional cues. */
export function buildAutoSubtitles(blocks: readonly AudioEditTranscriptBlock[], sampleRate: number, rate: VideoEditRatio, range: { startFrame: number; endFrame: number }, options: AutoSubtitleOptions = {}): VideoEditCaption[] {
  const settings = autoSubtitleOptionsSchema.parse(options)
  const groups: Array<{ text: string; start: number; end: number; word: boolean }> = []
  for (const block of [...blocks].sort((a, b) => a.startFrame - b.startFrame)) {
    if (!block.included || !block.text.trim()) continue
    if (!Number.isFinite(block.startFrame) || !Number.isFinite(block.endFrame) || block.endFrame <= block.startFrame) throw new Error('识别结果包含无效时间戳。')
    const previous = groups.at(-1); const text = block.text.trim()
    const joined = previous ? joinAudioEditText(previous.text, text) : text
    if (previous?.word && block.granularity === 'word' && !/[。！？.!?；;]$/.test(previous.text) && block.startFrame >= previous.end && block.startFrame - previous.end < sampleRate * .6 && Array.from(joined).length <= settings.maxCharacters * 2) {
      previous.text = joined; previous.end = block.endFrame
    } else groups.push({ text, start: block.startFrame, end: block.endFrame, word: block.granularity === 'word' })
  }
  const converted = groups.map(group => ({ start: range.startFrame + audioTimestampToVideoFrame(group.start, sampleRate, rate), end: range.startFrame + audioTimestampToVideoFrame(group.end, sampleRate, rate), text: wrapSubtitleText(group.text, settings.maxCharacters) }))
  const minimum = Math.round(settings.minDurationSeconds * rate.numerator / rate.denominator)
  return converted.flatMap((group, index) => {
    const start = Math.max(range.startFrame, group.start)
    const next = converted[index + 1]?.start ?? range.endFrame
    // Extend a short cue only into an actual gap; speech in the next cue always wins.
    const end = Math.min(range.endFrame, Math.max(group.end, Math.min(start + minimum, next)))
    return end > start ? [{ id: crypto.randomUUID(), start, duration: end - start, text: group.text }] : []
  })
}
