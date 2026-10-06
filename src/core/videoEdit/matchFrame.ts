import type { VideoEditClip, VideoEditDocument, VideoEditSequence } from './document'
import { videoEditFps, videoEditSourceSeconds } from './time'

/**
 * 匹配帧（Premiere F）与反向匹配帧（Shift+R）的落点计算，界面命令与测试共用。
 *
 * 匹配帧：优先用选中且压着播放头的片段，否则用播放头处目标轨道（没有目标轨道时全部轨道）最上层的片段；
 * 在源监视器打开它的素材，定位到播放头对应的源帧，并把源入出点设成片段用到的那一段（PR 同样带出入出点）。
 * 反向匹配帧：源监视器当前打开的素材在当前序列里哪一段用到了当前源帧，播放头就移到那一帧。
 */
export interface VideoEditMatchFrameTarget { clipId: string; itemId: string; timeUs: number; inUs: number | null; outUs: number | null }
export interface VideoEditReverseMatchTarget { clipId: string; frame: number }
type Clip = Pick<VideoEditClip, 'id' | 'itemId' | 'kind' | 'track' | 'start' | 'duration' | 'sourceInUs' | 'sourceRemainder'>
type MatchDocument = Pick<VideoEditDocument, 'items' | 'media'>
type MatchSequence = Pick<VideoEditSequence, 'clips' | 'tracks' | 'frameRate'>

function mediaOf(document: MatchDocument, clip: Pick<Clip, 'itemId'>) {
  const item = document.items.find(value => value.id === clip.itemId)
  return item?.mediaId ? document.media.find(media => media.id === item.mediaId) : undefined
}
/** 上层优先：画面轨编号大的在上，声音轨编号小的在上；画面先于声音。 */
function topmost(sequence: MatchSequence, clips: readonly Clip[]): Clip | undefined {
  const kind = (clip: Clip): 'video' | 'audio' => sequence.tracks.find(track => track.index === clip.track)?.kind ?? (clip.kind === 'audio' ? 'audio' : 'video')
  return [...clips].sort((a, b) => kind(a) !== kind(b) ? (kind(a) === 'video' ? -1 : 1) : kind(a) === 'video' ? b.track - a.track : a.track - b.track)[0]
}

export function videoEditMatchFrameTarget(document: MatchDocument, sequence: MatchSequence, input: { clipIds: readonly string[]; frame: number; targetTracks: readonly number[] }): VideoEditMatchFrameTarget | { reason: string } {
  const covering = (clip: Clip): boolean => clip.start <= input.frame && input.frame < clip.start + clip.duration && Boolean(mediaOf(document, clip))
  const selected = sequence.clips.filter(clip => input.clipIds.includes(clip.id) && covering(clip))
  const tracks = input.targetTracks.length ? input.targetTracks : sequence.tracks.map(track => track.index)
  const clip = topmost(sequence, selected.length ? selected : sequence.clips.filter(clip => tracks.includes(clip.track) && covering(clip)))
  if (!clip) return { reason: '播放头处没有来自素材文件的片段。' }
  const media = mediaOf(document, clip)!
  const fps = videoEditFps(sequence.frameRate)
  const durationUs = Math.round(media.durationSeconds * 1e6)
  if (media.kind === 'image') return { clipId: clip.id, itemId: clip.itemId, timeUs: 0, inUs: null, outUs: null }
  const start = videoEditSourceSeconds(clip)
  // 落在源帧中间，避免停在两帧交界被解码成前一帧（与源监视器逐帧步进同一取法）。
  const half = media.kind === 'video' && clip.kind !== 'audio' ? 0.5 / (media.frameRate ? videoEditFps(media.frameRate) : fps) : 0
  const timeUs = Math.min(durationUs, Math.round((start + (input.frame - clip.start) / fps + half) * 1e6))
  const inUs = Math.min(durationUs, Math.round(start * 1e6)); const outUs = Math.min(durationUs, Math.round((start + clip.duration / fps) * 1e6))
  return { clipId: clip.id, itemId: clip.itemId, timeUs, ...(outUs > inUs ? { inUs, outUs } : { inUs: null, outUs: null }) }
}

export function videoEditReverseMatchFrame(sequence: MatchSequence, input: { itemId: string; timeUs: number; frame: number; targetTracks: readonly number[] }): VideoEditReverseMatchTarget | { reason: string } {
  const fps = videoEditFps(sequence.frameRate)
  const seconds = input.timeUs / 1e6
  const candidates = sequence.clips.flatMap(clip => {
    if (clip.itemId !== input.itemId) return []
    const offset = seconds - videoEditSourceSeconds(clip)
    if (offset < -1e-6 || offset >= clip.duration / fps) return []
    return [{ clip, frame: clip.start + Math.min(clip.duration - 1, Math.max(0, Math.floor(offset * fps + 1e-6))) }]
  })
  if (!candidates.length) return { reason: '当前序列没有用到源监视器里的这一帧。' }
  // 目标轨道上的优先，其次离当前播放头最近。
  const best = candidates.sort((a, b) => Number(input.targetTracks.includes(b.clip.track)) - Number(input.targetTracks.includes(a.clip.track)) || Math.abs(a.frame - input.frame) - Math.abs(b.frame - input.frame))[0]
  return { clipId: best.clip.id, frame: best.frame }
}
