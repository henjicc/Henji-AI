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
  const codeImages = new Set([...items.flatMap(item => [...codeMaterialImageIds(item.code)]), ...document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => [...codeMaterialImageIds(clip.code)]))])
  return { ...document, items, media: document.media.filter(media => !removedMedia.has(media.id) || items.some(item => item.mediaId === media.id) || codeImages.has(media.id)) }
}
export function removeVideoEditBins(document: VideoEditDocument, ids: string[]): VideoEditDocument {
  for (const id of ids) {
    if (!document.bins.some(bin => bin.id === id)) throw new Error('素材箱不存在。')
    if (document.items.some(item => item.binId === id) || document.sequences.some(sequence => sequence.binId === id) || document.bins.some(bin => bin.parentId === id && !ids.includes(bin.id))) throw new Error('素材箱仍有内容，请先移动或移除其中的项目项和子素材箱。')
  }
  return { ...document, bins: document.bins.filter(bin => !ids.includes(bin.id)) }
}
export function makeVideoEditItemClip(document: VideoEditDocument, itemId: string, sequenceId: string, placement: { frame: number; track?: number }, codeMetadata?: CodeMaterialMetadataReader): VideoEditClip {
  const item = document.items.find(item => item.id === itemId)
  if (!item) throw new Error('项目项不存在。')
  const sequence = videoEditComposition(document, sequenceId)
  const media = document.media.find(media => media.id === item.mediaId)
  const trackKind = item.kind === 'audio' ? 'audio' : 'video'
  const track = placement.track ?? sequence.tracks.find(track => track.kind === trackKind && !track.locked && track.enabled)?.index ?? -1
  const target = sequence.tracks.find(value => value.index === track)
  if (!target || target.kind !== trackKind) throw new Error('请将素材放入对应的视频或音频轨道。')
  if (target.locked) throw new Error('目标轨道已锁定。')
  const program = item.code ? codeMetadata?.(item.code) : undefined
  if (item.kind === 'code' && (!program || !item.code)) throw new Error('代码素材尚未完成源码检查，不能添加占位片段。')
  const duration = program?.mode === 'dynamic' ? Math.max(1, Math.floor(program.durationSeconds * sequence.fps + 1e-6)) : media && media.kind !== 'image' ? Math.max(1, Math.floor(media.durationSeconds * sequence.fps + 1e-6)) : Math.round(sequence.fps * 3)
  if (!Number.isSafeInteger(placement.frame) || placement.frame < 0 || placement.frame + duration > Math.floor(sequence.fps * 1800)) throw new Error('素材落点或长度超出序列的 30 分钟范围，请先裁剪素材。')
  return { id: crypto.randomUUID(), itemId, name: item.name, kind: item.kind, ...(item.code ? { code: structuredClone(item.code) } : {}), track, start: placement.frame, duration, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: item.kind === 'text' ? '输入文字' : '' }
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
  return { ...createVideoEditSequence(item.name), ...(program ? { width: Math.max(16, program.width), height: Math.max(16, program.height) } : media && media.width >= 16 && media.height >= 16 ? { width: media.width, height: media.height } : {}), ...(supportedRate ? { frameRate: supportedRate } : {}), ...(item.binId ? { binId: item.binId } : {}), ...sequenceSettings, ...(binId !== undefined ? { binId: binId || undefined } : {}) }
}
export function makeVideoEditItemSequence(document: VideoEditDocument, itemIds: string[], settings: VideoEditSequenceSettings = {}, codeMetadata?: CodeMaterialMetadataReader): VideoEditSequence {
  if (!itemIds.length) throw new Error('请选择至少一个项目项。')
  const sequence = videoEditSequenceFromItem(document, itemIds[0], settings, codeMetadata)
  const candidate = { ...document, sequences: [...document.sequences, sequence] }
  let frame = 0
  sequence.clips = itemIds.map(itemId => { const clip = makeVideoEditItemClip(candidate, itemId, sequence.id, { frame }, codeMetadata); frame += clip.duration; return clip })
  return sequence
}
