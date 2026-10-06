import { z } from 'zod'
import type { AudioEditProjectDocument, AudioEditTranscriptBlock } from '../audioEdit/types'
import { applyAudioEditSuggestion, audioEditFillerBlockIds, DEFAULT_AUDIO_EDIT_SETTINGS } from '../audioEdit/edits'
import { findAudioEditText } from '../audioEdit/text'
import { joinAudioEditText } from '../audioEdit/captions'
import { videoEditClipSourceRange, videoEditClipFrameBoundaryAtSource, videoEditClipSourceSecondsAtTime } from './clipSpeed'
import type { VideoEditClip, VideoEditComposition } from './document'

const blockSchema = z.object({ id: z.string(), text: z.string().max(20000), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive(), included: z.boolean(), locked: z.boolean(), granularity: z.enum(['word', 'segment']) }).strict().refine(value => value.endFrame > value.startFrame)
const sourceRangeSchema = z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict().refine(value => value.endFrame > value.startFrame)
export const videoEditTextTranscriptionSchema = z.object({
  audioDocumentId: z.string().min(1),
  audioDocumentIds: z.array(z.string().min(1)).max(500).optional(),
  fillers: z.array(z.string().min(1).max(30)).max(100).optional(),
  sources: z.array(z.object({ itemId: z.string(), mediaIdentity: z.string(), audioMappingIdentity: z.string().optional(), coverage: z.array(sourceRangeSchema).max(500).optional(), blocks: z.array(blockSchema).max(100000), silences: z.array(sourceRangeSchema).max(100000) }).strict()).max(500),
}).strict()
export type VideoEditTextTranscription = z.infer<typeof videoEditTextTranscriptionSchema>
/** Keep recognition for other source ranges when only a selected clip is transcribed again. */
export function mergeVideoEditTextTranscription(previous: VideoEditTextTranscription | undefined, incoming: VideoEditTextTranscription): VideoEditTextTranscription {
  if (!previous) return incoming
  const sources = previous.sources.map(source => structuredClone(source))
  for (const source of incoming.sources) {
    const index = sources.findIndex(value => value.itemId === source.itemId && value.mediaIdentity === source.mediaIdentity && value.audioMappingIdentity === source.audioMappingIdentity)
    if (index < 0) { sources.push(source); continue }
    const old = sources[index]
    const covered = source.coverage ?? source.blocks
    const untouched = (range: { startFrame: number; endFrame: number }): boolean => !covered.some(value => value.startFrame < range.endFrame && value.endFrame > range.startFrame)
    sources[index] = { ...source, coverage: [...(old.coverage ?? []), ...(source.coverage ?? [])].slice(-500), blocks: [...old.blocks.filter(untouched), ...source.blocks].sort((a, b) => a.startFrame - b.startFrame), silences: [...old.silences.filter(untouched), ...source.silences] }
  }
  return videoEditTextTranscriptionSchema.parse({ ...incoming, audioDocumentIds: [...new Set([...(previous.audioDocumentIds ?? [previous.audioDocumentId]), ...(incoming.audioDocumentIds ?? [incoming.audioDocumentId])])], sources })
}
export interface VideoEditTextWord extends AudioEditTranscriptBlock { index: number; clipId: string; from: number; to: number }
export interface VideoEditTextRange { from: number; to: number }
// Source timestamps use integer microseconds, independent of sequence frame rate.
const SOURCE_RATE = 1_000_000
export function videoEditTextMediaIdentity(composition: VideoEditComposition, itemId: string): string {
  const item = composition.items.find(value => value.id === itemId)
  const media = composition.media.find(value => value.id === item?.mediaId)
  return JSON.stringify([item?.mediaId, media?.path, media?.sourceRevision, media?.assetContent, item?.sequenceId])
}
function sourceForClip(composition: VideoEditComposition, clip: VideoEditClip): VideoEditTextTranscription['sources'][number] | undefined {
  return composition.textTranscription?.sources.find(value => value.itemId === clip.itemId && value.mediaIdentity === videoEditTextMediaIdentity(composition, clip.itemId) && (value.audioMappingIdentity === undefined || value.audioMappingIdentity === JSON.stringify(clip.audioMapping ?? null)))
}
export function mapVideoEditTextRange(clip: VideoEditClip, range: { startFrame: number; endFrame: number }, fps: number): VideoEditTextRange | undefined {
  const source = videoEditClipSourceRange(clip, fps)
  const low = Math.max(source.from, range.startFrame / SOURCE_RATE); const high = Math.min(source.to, range.endFrame / SOURCE_RATE)
  if (high <= low) return undefined
  const from = Math.max(clip.start, Math.floor(videoEditClipFrameBoundaryAtSource(clip, clip.reverse ? high : low, fps) + 1e-6))
  const to = Math.min(clip.start + clip.duration, Math.ceil(videoEditClipFrameBoundaryAtSource(clip, clip.reverse ? low : high, fps) - 1e-6))
  return to > from ? { from, to } : undefined
}
export function videoEditTranscriptWords(composition: VideoEditComposition, clipIds?: readonly string[]): VideoEditTextWord[] {
  const words = composition.clips.flatMap(clip => {
    if (clipIds && !clipIds.includes(clip.id) || clip.sourceComponent === 'video') return []
    const source = sourceForClip(composition, clip)
    return (source?.blocks ?? []).flatMap(block => {
      if (!block.included || !block.text.trim()) return []
      const range = mapVideoEditTextRange(clip, block, composition.fps)
      return range ? [{ ...block, ...range, id: `${clip.id}:${block.id}`, clipId: clip.id, index: 0 }] : []
    })
  }).sort((a, b) => a.from - b.from || a.to - b.to || a.id.localeCompare(b.id))
  return words.map((word, index) => ({ ...word, index }))
}
export function mergeVideoEditTextRanges(ranges: readonly VideoEditTextRange[]): VideoEditTextRange[] {
  const merged: VideoEditTextRange[] = []
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0 || range.to <= range.from) throw new Error('文本时间范围无效。')
    const last = merged.at(-1)
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to)
    else merged.push({ ...range })
  }
  return merged
}
export function groupVideoEditTextWords(words: readonly VideoEditTextWord[], fps: number): VideoEditTextWord[][] {
  const groups: VideoEditTextWord[][] = []
  for (const word of words) {
    const previous = groups.at(-1); const last = previous?.at(-1)
    if (last && last.clipId === word.clipId && previous!.length < 128 && word.from - last.to < fps * .6 && !/[。！？.!?]$/.test(last.text)) previous!.push(word)
    else groups.push([word])
  }
  return groups
}
export const videoEditTextSelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('words'), ranges: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().refine(value => value.end >= value.start)).min(1).max(500) }).strict(),
  z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(20000), occurrence: z.number().int().nonnegative().optional() }).strict(),
  z.object({ kind: z.literal('fillers'), words: z.array(z.string().trim().min(1).max(30)).min(1).max(100).optional() }).strict(),
  z.object({ kind: z.literal('silence') }).strict(),
])
export type VideoEditTextSelector = z.infer<typeof videoEditTextSelectorSchema>
export function resolveVideoEditTextRanges(composition: VideoEditComposition, selector: VideoEditTextSelector): VideoEditTextRange[] {
  const parsed = videoEditTextSelectorSchema.parse(selector); const words = videoEditTranscriptWords(composition)
  if (parsed.kind === 'silence') return mergeVideoEditTextRanges(composition.clips.flatMap(clip => {
    const source = sourceForClip(composition, clip)
    return (source?.silences ?? []).flatMap(range => { const mapped = mapVideoEditTextRange(clip, range, composition.fps); return mapped ? [mapped] : [] })
  }))
  let groups: VideoEditTextWord[][]
  if (parsed.kind === 'words') groups = parsed.ranges.map(range => {
    if (range.end >= words.length) throw new Error('词索引超出当前稿子，请重新读取转录稿。')
    return words.slice(range.start, range.end + 1)
  })
  else if (parsed.kind === 'text') {
    // Match within spoken paragraphs: never bridge a removed clip or a long pause.
    const matches = groupVideoEditTextWords(words, composition.fps).flatMap(group => {
      const searchable = group.map((word, index) => ({ ...word, text: index ? joinAudioEditText(group[index - 1].text, word.text).slice(group[index - 1].text.length) : word.text }))
      return findAudioEditText(searchable, parsed.text).map(match => group.filter(word => match.blockIds.includes(word.id)))
    })
    groups = parsed.occurrence === undefined ? matches : matches[parsed.occurrence] ? [matches[parsed.occurrence]] : []
    if (!groups.length) throw new Error('text 未匹配当前稿子，请读取转录稿后使用原文或词索引。')
  } else {
    const ids = new Set(audioEditFillerBlockIds(words, parsed.words ?? composition.textTranscription?.fillers ?? [...DEFAULT_AUDIO_EDIT_SETTINGS.fillers, '啊', '那个']))
    groups = words.filter(word => ids.has(word.id)).map(word => [word])
  }
  if (groups.some(group => group.some(word => word.locked))) throw new Error('选中文字包含受保护或重叠说话内容，请解锁原口播内容或只转录明确的人声轨道。')
  // Segment timestamps may be displayed and clicked, but must never be guessed for destructive edits.
  if (groups.some(group => group.some(word => word.granularity !== 'word'))) throw new Error('此识别结果只有句级时间，请先使用支持词级时间戳的识别模型。')
  return mergeVideoEditTextRanges(groups.map(group => ({ from: Math.min(...group.map(word => word.from)), to: Math.max(...group.map(word => word.to)) })))
}

/** Reuse voiceover protections and retained pause duration; ASR timestamp gaps are not silence evidence. */
export function buildVideoEditTextTranscription(composition: VideoEditComposition, clips: readonly VideoEditClip[], audio: AudioEditProjectDocument, startFrame: number, identities?: Readonly<Record<string, string>>): VideoEditTextTranscription {
  let cleaned = audio
  for (const suggestion of audio.suggestions.filter(value => value.kind === 'long_silence')) cleaned = applyAudioEditSuggestion(cleaned, suggestion.id)
  const silence = (cleaned.cuts ?? []).filter(value => value.enabled && value.reason === 'silence' && value.mode !== 'mute')
  const sources = new Map<string, VideoEditTextTranscription['sources'][number]>()
  const convert = (clip: VideoEditClip, range: { startFrame: number; endFrame: number }): { startFrame: number; endFrame: number } | undefined => {
    const from = Math.max(clip.start, startFrame + range.startFrame * composition.fps / audio.source.sampleRate)
    const to = Math.min(clip.start + clip.duration, startFrame + range.endFrame * composition.fps / audio.source.sampleRate)
    if (to <= from) return undefined
    const a = videoEditClipSourceSecondsAtTime(clip, from / composition.fps, composition.fps); const b = videoEditClipSourceSecondsAtTime(clip, to / composition.fps, composition.fps)
    return { startFrame: Math.max(0, Math.round(Math.min(a, b) * SOURCE_RATE)), endFrame: Math.round(Math.max(a, b) * SOURCE_RATE) }
  }
  const speech = clips.filter(clip => (!clip.audioRole || clip.audioRole === 'dialogue') && ['audio', 'video'].includes(clip.kind) && clip.sourceComponent !== 'video')
  for (const clip of speech) {
    if (!['audio', 'video'].includes(clip.kind) || clip.sourceComponent === 'video') continue
    const audioMappingIdentity = JSON.stringify(clip.audioMapping ?? null); const key = `${clip.itemId}:${audioMappingIdentity}`
    const entry: VideoEditTextTranscription['sources'][number] = sources.get(key) ?? { itemId: clip.itemId, mediaIdentity: identities?.[clip.itemId] ?? videoEditTextMediaIdentity(composition, clip.itemId), audioMappingIdentity, coverage: [], blocks: [], silences: [] }
    const coverage = convert(clip, { startFrame: 0, endFrame: audio.source.durationFrames })
    if (coverage && coverage.endFrame > coverage.startFrame) entry.coverage?.push(coverage)
    for (const block of audio.transcript) {
      const range = convert(clip, block)
      if (!range || range.endFrame <= range.startFrame) continue
      const from = startFrame + block.startFrame * composition.fps / audio.source.sampleRate; const to = startFrame + block.endFrame * composition.fps / audio.source.sampleRate
      // Overlapping voices cannot be assigned to a source safely. Display them but lock text edits.
      const ambiguous = speech.some(other => other.id !== clip.id && other.start < Math.min(to, clip.start + clip.duration) && other.start + other.duration > Math.max(from, clip.start))
      const word = { id: `${block.id}:${clip.id}`, text: block.text, ...range, granularity: block.granularity, included: block.included, locked: block.locked || ambiguous }
      const adjacent = entry.blocks.find(value => value.id.startsWith(`${block.id}:`) && value.text === word.text && value.startFrame <= word.endFrame && value.endFrame >= word.startFrame)
      if (adjacent) { adjacent.startFrame = Math.min(adjacent.startFrame, word.startFrame); adjacent.endFrame = Math.max(adjacent.endFrame, word.endFrame); adjacent.locked ||= word.locked }
      else if (!entry.blocks.some(value => value.startFrame === word.startFrame && value.endFrame === word.endFrame && value.text === word.text)) entry.blocks.push(word)
    }
    for (const value of silence) { const range = convert(clip, value); if (range && range.endFrame > range.startFrame) entry.silences.push(range) }
    sources.set(key, entry)
  }
  return videoEditTextTranscriptionSchema.parse({ audioDocumentId: audio.id, audioDocumentIds: [audio.id], fillers: audio.batchSettings?.fillers ?? [...DEFAULT_AUDIO_EDIT_SETTINGS.fillers, '啊', '那个'], sources: [...sources.values()] })
}
