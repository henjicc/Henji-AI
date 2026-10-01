import { createVideoEditSequence, videoEditComposition, type VideoEditClip, type VideoEditDocument, type VideoEditSequence } from './document'
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
    if (!item) throw new Error('项目项不存在。')
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
    if (document.items.some(item => item.binId === id) || document.sequences.some(sequence => sequence.binId === id) || document.bins.some(bin => bin.parentId === id && !ids.includes(bin.id))) throw new Error('素材箱仍有内容，请先移动或移除其中的项目项和子素材箱。')
  }
  return { ...document, bins: document.bins.filter(bin => !ids.includes(bin.id)) }
}
export function makeVideoEditItemClip(document: VideoEditDocument, itemId: string, sequenceId: string, placement: { frame: number; track?: number; duration?: number; sourceComponent?: 'video' | 'audio'; sourceInUs?: number; sourceOutUs?: number }, codeMetadata?: CodeMaterialMetadataReader): VideoEditClip {
  const item = document.items.find(item => item.id === itemId)
  if (!item) throw new Error('项目项不存在。')
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
  const sourceInUs = placement.sourceInUs ?? 0
  const sourceOutUs = placement.sourceOutUs ?? (media && media.kind !== 'image' ? Math.round(media.durationSeconds * 1e6) : undefined)
  const ranged = placement.sourceInUs !== undefined || placement.sourceOutUs !== undefined
  if (ranged && (!media || media.kind === 'image' || !Number.isSafeInteger(sourceInUs) || sourceInUs < 0 || !Number.isSafeInteger(sourceOutUs) || sourceOutUs! <= sourceInUs || sourceOutUs! > Math.round(media.durationSeconds * 1e6))) throw new Error('源范围须为原音视频素材内的正向整数微秒区间。')
  const availableDuration = ranged ? Math.floor((sourceOutUs! - sourceInUs) / 1e6 * sequence.fps + 1e-6) : program?.mode === 'dynamic' ? Math.max(1, Math.floor(program.durationSeconds * sequence.fps + 1e-6)) : media && media.kind !== 'image' ? Math.max(1, Math.floor(media.durationSeconds * sequence.fps + 1e-6)) : Math.round(sequence.fps * 3)
  const duration = placement.duration ?? availableDuration
  if (availableDuration < 1) throw new Error('源选区短于一个序列帧。')
  if (!Number.isSafeInteger(duration) || duration < 1 || (media && media.kind !== 'image' || program?.mode === 'dynamic') && duration > availableDuration) throw new Error('片段时长必须为源范围内的正整数帧。')
  if (duration < 1) throw new Error('源选区短于一个序列帧。')
  if (!Number.isSafeInteger(placement.frame) || placement.frame < 0 || placement.frame + duration > Math.floor(sequence.fps * 1800)) throw new Error('素材落点或长度超出序列的 30 分钟范围，请先裁剪素材。')
  return { id: crypto.randomUUID(), itemId, name: item.name, kind, ...(placement.sourceComponent ? { sourceComponent: placement.sourceComponent } : {}), ...(item.code ? { code: structuredClone(item.code) } : {}), ...(item.graphic ? { graphic: structuredClone(item.graphic) } : {}), ...(kind === 'adjustment' ? { adjustment: { fromTrack: Math.min(...lowerVisualTracks(track).map(track => track.index)) } } : {}), track, start: placement.frame, duration, sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: kind === 'adjustment' ? 0 : 1, brightness: 1, text: item.kind === 'text' ? '输入文字' : '' }
}
export function videoEditSequenceFromItem(document: VideoEditDocument, itemId: string, settings: VideoEditSequenceSettings = {}, codeMetadata?: CodeMaterialMetadataReader): VideoEditSequence {
  const { binId, ...sequenceSettings } = settings
  const item = document.items.find(item => item.id === itemId)
  if (!item) throw new Error('项目项不存在。')
  const media = document.media.find(media => media.id === item.mediaId)
  const program = item.code ? codeMetadata?.(item.code) : undefined
  if (item.kind === 'code' && !program) throw new Error('代码素材尚未完成源码检查。')
  const sourceRate = media?.frameRate
  const supportedRate = sourceRate && VIDEO_EDIT_FRAME_RATES.find(rate => Math.abs(videoEditFps(rate) - videoEditFps(sourceRate)) < 0.01)
  if (media?.kind === 'video' && (!supportedRate || media.frameRateMode !== 'sampled-constant') && !settings.frameRate) throw new VideoEditSequenceFrameRateRequired({ name: item.name, width: media.width, height: media.height, ...(item.binId ? { binId: item.binId } : {}) })
  return { ...createVideoEditSequence(item.name), ...(program ? { width: Math.max(16, program.width), height: Math.max(16, program.height) } : item.graphic ? { width: item.graphic.width, height: item.graphic.height } : media && media.width >= 16 && media.height >= 16 ? { width: media.width, height: media.height } : {}), ...(supportedRate ? { frameRate: supportedRate } : {}), ...(item.binId ? { binId: item.binId } : {}), ...sequenceSettings, ...(binId !== undefined ? { binId: binId || undefined } : {}) }
}
export function makeVideoEditItemSequence(document: VideoEditDocument, itemIds: string[], settings: VideoEditSequenceSettings = {}, codeMetadata?: CodeMaterialMetadataReader): VideoEditSequence {
  if (!itemIds.length) throw new Error('请选择至少一个项目项。')
  const sequence = videoEditSequenceFromItem(document, itemIds[0], settings, codeMetadata)
  const candidate = { ...document, sequences: [...document.sequences, sequence] }
  let frame = 0
  sequence.clips = itemIds.map(itemId => { const clip = makeVideoEditItemClip(candidate, itemId, sequence.id, { frame }, codeMetadata); frame += clip.duration; return clip })
  return sequence
}
