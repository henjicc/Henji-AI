import { findTranscriptSearchRanges } from '../media/transcriptSearch'
import { joinAudioEditText } from '../audioEdit/captions'
import type { VideoEditComposition } from './document'
import { groupVideoEditTextWords, videoEditTranscriptWords, type VideoEditTextWord } from './textTranscript'

export interface VideoEditTranscriptQuery {
  text?: string; from?: number; to?: number; clipId?: string; itemId?: string
  source?: 'all' | 'asr' | 'caption'; contextWords?: number
}
export interface VideoEditTranscriptMatch {
  text: string; before: string; after: string; from: number; to: number
  source: 'asr' | 'caption'; precision: 'word' | 'segment' | 'caption'; editable: boolean
  clipId?: string; itemId?: string; sourceRange?: { startUs: number; endUs: number }
  wordRange?: { start: number; end: number }
  wordSignature?: string
}
export function videoEditTranscriptWordSignature(words: readonly VideoEditTextWord[]): string {
  return JSON.stringify(words.map(word => [word.id, word.text, word.clipId, word.sourceItemId, word.startFrame, word.endFrame, word.from, word.to, word.granularity]))
}
function join(words: readonly { text: string }[]): string {
  let text = ''
  for (const word of words) {
    text = joinAudioEditText(text, word.text.slice(0, 4000))
    if (text.length >= 4000) return text.slice(0, 4000)
  }
  return text
}

/** Uses the existing audible source projection: trims, retimes and nesting have one time map. */
export function queryVideoEditTranscript(composition: VideoEditComposition, query: VideoEditTranscriptQuery): VideoEditTranscriptMatch[] {
  const words = query.source === 'caption' ? [] : videoEditTranscriptWords(composition)
  const clipsById = new Map(composition.clips.map(clip => [clip.id, clip]))
  const lockedTracks = new Set(composition.tracks.filter(track => track.locked).map(track => track.index))
  const lockedClips = composition.clips.filter(clip => lockedTracks.has(clip.track))
  const target = query.clipId ? composition.clips.find(clip => clip.id === query.clipId) : undefined
  if (query.clipId && !target) throw new Error('目标片段不属于此序列。')
  if (query.itemId && !composition.items.some(item => item.id === query.itemId)) throw new Error('目标素材不属于此剪辑。')
  const clipIds = target ? new Set(composition.clips.filter(clip => clip.id === target.id || Boolean(target.linkId && clip.linkId === target.linkId)).map(clip => clip.id)) : undefined
  const relevant = (word: VideoEditTextWord) => (!clipIds || clipIds.has(word.clipId)) && (!query.itemId || word.sourceItemId === query.itemId || clipsById.get(word.clipId)?.itemId === query.itemId)
  const inRange = (value: { from: number; to: number }) => value.to > (query.from ?? 0) && value.from < (query.to ?? Infinity)
  const context = query.contextWords ?? 6
  const matches: VideoEditTranscriptMatch[] = []
  if (query.source !== 'caption') for (const group of groupVideoEditTextWords(words.filter(relevant), composition.fps)) {
    const ranges = query.text ? findTranscriptSearchRanges(group, query.text) : Array.from({ length: Math.ceil(group.length / 32) }, (_, index) => ({ start: index * 32, end: Math.min(group.length - 1, index * 32 + 31) }))
    for (const range of ranges) {
      const selected = group.slice(range.start, range.end + 1)
      let from = Infinity; let to = 0; let startUs = Infinity; let endUs = 0
      for (const word of selected) {
        from = Math.min(from, word.from); to = Math.max(to, word.to)
        startUs = Math.min(startUs, word.startFrame); endUs = Math.max(endUs, word.endFrame)
      }
      if (!inRange({ from, to })) continue
      const exact = selected.every(word => word.granularity === 'word')
      const editable = exact && selected.every(word => !word.locked) && !lockedClips.some(clip => clip.start < to && clip.start + clip.duration > from)
      matches.push({ text: join(selected), before: join(group.slice(Math.max(0, range.start - context), range.start)), after: join(group.slice(range.end + 1, range.end + 1 + context)), from, to, source: 'asr', precision: exact ? 'word' : 'segment', editable,
        clipId: selected[0].clipId, itemId: selected[0].sourceItemId,
        sourceRange: { startUs, endUs },
        ...(exact ? { wordRange: { start: selected[0].index, end: selected.at(-1)!.index }, wordSignature: videoEditTranscriptWordSignature(selected) } : {}) })
    }
  }
  if (query.source !== 'asr') for (const caption of composition.captions ?? []) {
    const span = { from: caption.start, to: caption.start + caption.duration }
    if (!inRange(span)) continue
    const clips = composition.clips.filter(clip => clip.start < span.to && clip.start + clip.duration > span.from && (!caption.clipId || clip.id === caption.clipId))
    if (clipIds && !clips.some(clip => clipIds.has(clip.id)) || query.itemId && !clips.some(clip => clip.itemId === query.itemId)) continue
    if (query.text && !findTranscriptSearchRanges([{ text: caption.text }], query.text).length) continue
    matches.push({ text: caption.text.slice(0, 4000), before: '', after: '', ...span, source: 'caption', precision: 'caption', editable: false, ...(caption.clipId ? { clipId: caption.clipId } : {}), ...(clips.length === 1 ? { itemId: clips[0].itemId } : {}) })
  }
  return matches.sort((left, right) => left.from - right.from || left.to - right.to || left.source.localeCompare(right.source))
}
