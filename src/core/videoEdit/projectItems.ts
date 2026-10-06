import { createVideoEditSequence, videoEditComposition, type VideoEditClip, type VideoEditDocument, type VideoEditSequence } from './document'
import { videoEditIsDefaultAudioMapping, videoEditItemAudioLayout, type VideoEditAudioMapping } from './audioChannels'
import { VIDEO_EDIT_FRAME_RATES, videoEditFps } from './time'
import type { CodeMaterialMetadataReader } from './codeMaterialDocument'
import { codeMaterialImageIds } from './codeMaterialResources'

export type VideoEditSequenceSettings = Partial<Pick<VideoEditSequence, 'name' | 'width' | 'height' | 'frameRate' | 'pixelAspectRatio' | 'sampleRate' | 'channels'>> & { binId?: string | null }
export class VideoEditSequenceFrameRateRequired extends Error {
  constructor(readonly settings: VideoEditSequenceSettings) { super('此素材的帧率不固定或未能可靠检测，请在序列设置中选择剪辑帧率。'); this.name = 'VideoEditSequenceFrameRateRequired' }
}
export function videoEditItemUsage(document: VideoEditDocument, itemId: string): Array<{ sequenceId: string; sequenceName: string; clipId: string }> {
  return document.sequences.flatMap(sequence => sequence.clips.filter(clip => clip.itemId === itemId).map(clip => ({ sequenceId: sequence.id, sequenceName: sequence.name, clipId: clip.id })))
}
export function removeVideoEditItems(document: VideoEditDocument, ids: string[]): VideoEditDocument {
  for (const id of ids) {
    const item = document.items.find(item => item.id === id)
    if (!item) throw new Error('素材项不存在。')
    const used = videoEditItemUsage(document, id)
    if (used.length) throw new Error(`“${item.name}”仍被序列“${used[0].sequenceName}”等 ${used.length} 个片段引用。请先移除这些片段。`)
  }
  const items = document.items.filter(item => !ids.includes(item.id))
  const removedMedia = new Set(document.items.filter(item => ids.includes(item.id)).flatMap(item => [item.mediaId, ...codeMaterialImageIds(item.code)]))
  const codeImages = new Set([...items.flatMap(item => [...codeMaterialImageIds(item.code)]), ...document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => [...codeMaterialImageIds(clip.code), ...(clip.effects ?? []).flatMap(effect => [...codeMaterialImageIds(effect.code)])]))])
  return { ...document, items, media: document.media.filter(media => !removedMedia.has(media.id) || items.some(item => item.mediaId === media.id) || codeImages.has(media.id)) }
}
export function removeVideoEditBins(document: VideoEditDocument, ids: string[]): VideoEditDocument {
  for (const id of ids) {
    if (!document.bins.some(bin => bin.id === id)) throw new Error('素材箱不存在。')
    if (document.items.some(item => item.binId === id) || document.sequences.some(sequence => sequence.binId === id) || document.bins.some(bin => bin.parentId === id && !ids.includes(bin.id))) throw new Error('素材箱仍有内容，请先移动或移除其中的素材项和子素材箱。')
  }
  return { ...document, bins: document.bins.filter(bin => !ids.includes(bin.id)) }
}
export function makeVideoEditItemClip(document: VideoEditDocument, itemId: string, sequenceId: string, placement: { frame: number; track?: number; duration?: number; sourceComponent?: 'video' | 'audio'; sourceInUs?: number; sourceOutUs?: number; audioMapping?: VideoEditAudioMapping }, codeMetadata?: CodeMaterialMetadataReader): VideoEditClip {
  const item = document.items.find(item => item.id === itemId)
  if (!item) throw new Error('素材项不存在。')
  const sequence = videoEditComposition(document, sequenceId)
  const media = document.media.find(media => media.id === item.mediaId)
  if (placement.sourceComponent && (item.kind !== 'video' || placement.sourceComponent === 'audio' && media?.hasAudio !== true)) throw new Error('此素材没有已确认可引用的音画分量。')
  const kind = placement.sourceComponent === 'audio' ? 'audio' : item.kind
  const trackKind = kind === 'audio' ? 'audio' : 'video'
  const lowerVisualTracks = (index: number) => sequence.tracks.filter(track => track.kind === 'video' && track.index < index)
  const track = placement.track ?? sequence.tracks.find(track => track.kind === trackKind && !track.locked && track.enabled && (kind !== 'adjustment' || lowerVisualTracks(track.index).length > 0))?.index ?? -1
  if (kind === 'adjustment' && !lowerVisualTracks(track).length) throw new Error('调整图层需要位于画面上方的视频轨道，请先添加上方轨道。')
  const target = sequence.tracks.find(value => value.index === track)
  if (!target || target.kind !== trackKind) throw new Error('请将素材放入对应的视频或音频轨道。')
  if (target.locked) throw new Error('目标轨道已锁定。')
  const program = item.code ? codeMetadata?.(item.code) : undefined
  if (item.kind === 'code' && (!program || !item.code)) throw new Error('代码素材尚未完成源码检查，不能添加占位片段。')
  const sourceInUs = placement.sourceInUs ?? item.sourceRange?.inUs ?? 0
  const sourceOutUs = placement.sourceOutUs ?? item.sourceRange?.outUs ?? (media && media.kind !== 'image' ? Math.round(media.durationSeconds * 1e6) : undefined)
  const ranged = placement.sourceInUs !== undefined || placement.sourceOutUs !== undefined || item.sourceRange !== undefined
  if (ranged && (!media || media.kind === 'image' || !Number.isSafeInteger(sourceInUs) || sourceInUs < 0 || !Number.isSafeInteger(sourceOutUs) || sourceOutUs! <= sourceInUs || sourceOutUs! > Math.round(media.durationSeconds * 1e6))) throw new Error('源范围须为原音视频素材内的正向整数微秒区间。')
  const availableDuration = ranged ? Math.floor((sourceOutUs! - sourceInUs) / 1e6 * sequence.fps + 1e-6) : program?.mode === 'dynamic' ? Math.max(1, Math.floor(program.durationSeconds * sequence.fps + 1e-6)) : media && media.kind !== 'image' ? Math.max(1, Math.floor(media.durationSeconds * sequence.fps + 1e-6)) : Math.round(sequence.fps * 3)
  const duration = placement.duration ?? availableDuration
  if (availableDuration < 1) throw new Error('源选区短于一个序列帧。')
  if (!Number.isSafeInteger(duration) || duration < 1 || (media && media.kind !== 'image' || program?.mode === 'dynamic') && duration > availableDuration) throw new Error('片段时长必须为源范围内的正整数帧。')
  if (duration < 1) throw new Error('源选区短于一个序列帧。')
  if (!Number.isSafeInteger(placement.frame) || placement.frame < 0 || placement.frame + duration > Math.floor(sequence.fps * 1800)) throw new Error('素材落点或长度超出序列的 30 分钟范围，请先裁剪素材。')
  return { id: crypto.randomUUID(), itemId, name: item.name, kind, ...(placement.sourceComponent ? { sourceComponent: placement.sourceComponent } : {}), ...(placement.audioMapping ? { audioMapping: structuredClone(placement.audioMapping) } : {}), ...(item.code ? { code: structuredClone(item.code) } : {}), ...(item.graphic ? { graphic: structuredClone(item.graphic) } : {}), ...(kind === 'adjustment' ? { adjustment: { fromTrack: Math.min(...lowerVisualTracks(track).map(track => track.index)) } } : {}), track, start: placement.frame, duration, sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: kind === 'adjustment' ? 0 : 1, brightness: 1, text: item.kind === 'text' ? '输入文字' : '' }
}
type VideoEditTrack = VideoEditSequence['tracks'][number]
export type VideoEditItemComponents = 'auto' | 'linked' | 'video' | 'audio'
/**
 * `track` is where the item was dropped (its picture, or its first audio clip for sound-only items); without it the
 * targeted `videoTrack` / `audioTrack` apply. Further audio clips go on the following audio tracks.
 */
export interface VideoEditItemPlacement { frame: number; track?: number; videoTrack?: number; audioTrack?: number; duration?: number; sourceInUs?: number; sourceOutUs?: number; components?: VideoEditItemComponents }
/**
 * Audio tracks for `count` clips, Premiere-style: the first is `start` (or the first unlocked, enabled audio track),
 * the rest the following unlocked audio tracks; missing ones are appended below the last audio track.
 */
function audioTracksFor(sequence: VideoEditSequence, count: number, start: number | undefined): { indexes: number[]; added: VideoEditTrack[] } {
  const audio = sequence.tracks.filter(track => track.kind === 'audio').sort((a, b) => a.index - b.index)
  const first = start ?? audio.find(track => !track.locked && track.enabled)?.index
  const from = first === undefined ? audio.length : audio.findIndex(track => track.index === first)
  if (from < 0) throw new Error('请将声音放入音频轨道。')
  const indexes = audio.slice(from).filter((track, offset) => offset === 0 && start !== undefined || !track.locked).map(track => track.index).slice(0, count)
  const added: VideoEditTrack[] = []
  for (let next = Math.max(-1, ...sequence.tracks.filter(track => track.kind === 'audio').map(track => track.index)) + 1; indexes.length < count; next++) {
    while (sequence.tracks.some(track => track.index === next)) next++
    if (next > 31 || sequence.tracks.length + added.length >= 32) throw new Error('序列最多 32 条轨道，放不下此素材的全部音频片段。请减少素材的音频片段数量。')
    added.push({ id: crypto.randomUUID(), name: `音频 ${audio.length + added.length + 1}`, index: next, kind: 'audio', locked: false, enabled: true, muted: false, solo: false })
    indexes.push(next)
  }
  return { indexes, added }
}
/**
 * The clips one project item places, as Premiere does: a video with sound becomes its picture plus one linked audio
 * clip per entry of the item's audio layout, on consecutive audio tracks (`auto` and `linked` alike); `video`/`audio`
 * place one part only. Picture-and-sound clips of older projects stay valid but are no longer created here.
 * Tracks the sound needs are returned in `addedTracks`; the clips already reference them.
 */
export function placeVideoEditItem(document: VideoEditDocument, itemId: string, sequenceId: string, placement: VideoEditItemPlacement, codeMetadata?: CodeMaterialMetadataReader): { clips: VideoEditClip[]; addedTracks: VideoEditTrack[] } {
  const item = document.items.find(item => item.id === itemId)
  if (!item) throw new Error('素材项不存在。')
  const sequence = document.sequences.find(sequence => sequence.id === sequenceId)
  if (!sequence) throw new Error('目标序列不存在。')
  const media = document.media.find(media => media.id === item.mediaId)
  const components = placement.components ?? 'auto'
  const range = { frame: placement.frame, ...(placement.duration !== undefined ? { duration: placement.duration } : {}), ...(placement.sourceInUs !== undefined ? { sourceInUs: placement.sourceInUs } : {}), ...(placement.sourceOutUs !== undefined ? { sourceOutUs: placement.sourceOutUs } : {}) }
  const explicit = placement.track ?? (item.kind === 'audio' || item.kind === 'video' && components === 'audio' ? placement.audioTrack : placement.videoTrack)
  const primaryTrack = explicit !== undefined ? { track: explicit } : {}
  const sounding = media && (item.kind === 'audio' || item.kind === 'video' && media.hasAudio === true)
  if (!sounding || components === 'video') {
    return { clips: [makeVideoEditItemClip(document, itemId, sequenceId, { ...range, ...primaryTrack, ...(item.kind === 'video' && components !== 'auto' ? { sourceComponent: components === 'audio' ? 'audio' as const : 'video' as const } : {}) }, codeMetadata)], addedTracks: [] }
  }
  const layout: Array<VideoEditAudioMapping | undefined> = videoEditItemAudioLayout(item, media) ?? [undefined]
  const mappingOf = (mapping: VideoEditAudioMapping | undefined): { audioMapping?: VideoEditAudioMapping } => mapping && !videoEditIsDefaultAudioMapping(mapping, media.audioStreams) ? { audioMapping: mapping } : {}
  const picture = item.kind === 'video' && components !== 'audio'
  const tracks = audioTracksFor(sequence, layout.length, picture ? placement.audioTrack : explicit)
  const candidate = tracks.added.length ? { ...document, sequences: document.sequences.map(value => value.id === sequenceId ? { ...value, tracks: [...value.tracks, ...tracks.added] } : value) } : document
  const linkId = picture || layout.length > 1 ? crypto.randomUUID() : undefined
  const clips = [
    ...(picture ? [makeVideoEditItemClip(candidate, itemId, sequenceId, { ...range, ...primaryTrack, sourceComponent: 'video' }, codeMetadata)] : []),
    ...layout.map((mapping, index) => makeVideoEditItemClip(candidate, itemId, sequenceId, { ...range, track: tracks.indexes[index], ...(item.kind === 'video' ? { sourceComponent: 'audio' as const } : {}), ...mappingOf(mapping) }, codeMetadata)),
  ]
  return { clips: linkId ? clips.map(clip => ({ ...clip, linkId })) : clips, addedTracks: tracks.added }
}
/** Places items one after another from `placement.frame`; later items reuse the audio tracks earlier ones added. */
export function placeVideoEditItems(document: VideoEditDocument, itemIds: readonly string[], sequenceId: string, placement: VideoEditItemPlacement, codeMetadata?: CodeMaterialMetadataReader): { clips: VideoEditClip[]; addedTracks: VideoEditTrack[]; primaryIds: string[] } {
  let candidate = document; let frame = placement.frame
  const clips: VideoEditClip[] = []; const addedTracks: VideoEditTrack[] = []; const primaryIds: string[] = []
  for (const itemId of itemIds) {
    const placed = placeVideoEditItem(candidate, itemId, sequenceId, { ...placement, frame }, codeMetadata)
    if (placed.addedTracks.length) candidate = { ...candidate, sequences: candidate.sequences.map(value => value.id === sequenceId ? { ...value, tracks: [...value.tracks, ...placed.addedTracks] } : value) }
    clips.push(...placed.clips); addedTracks.push(...placed.addedTracks); primaryIds.push(placed.clips[0].id)
    frame += placed.clips[0].duration
  }
  return { clips, addedTracks, primaryIds }
}
export function videoEditSequenceFromItem(document: VideoEditDocument, itemId: string, settings: VideoEditSequenceSettings = {}, codeMetadata?: CodeMaterialMetadataReader): VideoEditSequence {
  const { binId, ...sequenceSettings } = settings
  const item = document.items.find(item => item.id === itemId)
  if (!item) throw new Error('素材项不存在。')
  const media = document.media.find(media => media.id === item.mediaId)
  const program = item.code ? codeMetadata?.(item.code) : undefined
  if (item.kind === 'code' && !program) throw new Error('代码素材尚未完成源码检查。')
  const sourceRate = media?.frameRate
  const supportedRate = sourceRate && VIDEO_EDIT_FRAME_RATES.find(rate => Math.abs(videoEditFps(rate) - videoEditFps(sourceRate)) < 0.01)
  if (media?.kind === 'video' && (!supportedRate || media.frameRateMode !== 'sampled-constant') && !settings.frameRate) throw new VideoEditSequenceFrameRateRequired({ name: item.name, width: media.width, height: media.height, ...(item.binId ? { binId: item.binId } : {}) })
  return { ...createVideoEditSequence(item.name), ...(program ? { width: Math.max(16, program.width), height: Math.max(16, program.height) } : item.graphic ? { width: item.graphic.width, height: item.graphic.height } : media && media.width >= 16 && media.height >= 16 ? { width: media.width, height: media.height } : {}), ...(supportedRate ? { frameRate: supportedRate } : {}), ...(item.binId ? { binId: item.binId } : {}), ...sequenceSettings, ...(binId !== undefined ? { binId: binId || undefined } : {}) }
}
export function makeVideoEditItemSequence(document: VideoEditDocument, itemIds: string[], settings: VideoEditSequenceSettings = {}, codeMetadata?: CodeMaterialMetadataReader): VideoEditSequence {
  if (!itemIds.length) throw new Error('请选择至少一个素材项。')
  const sequence = videoEditSequenceFromItem(document, itemIds[0], settings, codeMetadata)
  const placed = placeVideoEditItems({ ...document, sequences: [...document.sequences, sequence] }, itemIds, sequence.id, { frame: 0 }, codeMetadata)
  return { ...sequence, tracks: [...sequence.tracks, ...placed.addedTracks], clips: placed.clips }
}
