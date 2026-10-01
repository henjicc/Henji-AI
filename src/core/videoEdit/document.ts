import { z } from 'zod'
import { offsetVideoEditSource, rescaleVideoEditFrame, videoEditFps, videoEditRatioSchema, videoEditSourceSeconds, VIDEO_EDIT_FRAME_RATES } from './time'
import { codeMaterialDefinitionsSchema, codeMaterialInstanceSchema } from './codeMaterialPersistence'
import type { CodeMaterialMetadataReader } from './codeMaterialDocument'

const frame = z.number().int().min(0).max(108_000)
const identifier = z.string().min(1).max(100)
const name = z.string().trim().min(1).max(200)
const sourceRemainder = z.object({ numerator: z.number().int().nonnegative().max(1_000_000), denominator: z.number().int().positive().max(1_000_000) }).strict().refine(value => value.numerator < value.denominator, '源时间分数必须小于一微秒。')
export const videoEditMediaSchema = z.object({
  id: identifier, name, path: z.string().min(1).max(32768).regex(/^(?:[A-Za-z]:[\\/]|\\\\|\/)/, '素材必须引用本地绝对路径。'),
  kind: z.enum(['video', 'audio', 'image']), durationSeconds: z.number().finite().nonnegative(),
  width: z.number().int().nonnegative(), height: z.number().int().nonnegative(),
  assetId: identifier.optional(), sourceRevision: identifier.optional(), frameRate: videoEditRatioSchema.optional(), frameRateMode: z.enum(['sampled-constant', 'variable', 'unknown']).optional(),
}).strict()
export const videoEditBinSchema = z.object({ id: identifier, name, parentId: identifier.optional() }).strict()
export const videoEditItemSchema = z.object({ id: identifier, name, binId: identifier.optional(), tags: z.array(z.string().trim().min(1).max(80)).max(32).optional(), kind: z.enum(['video', 'audio', 'image', 'text', 'code']), mediaId: identifier.optional(), code: codeMaterialInstanceSchema.optional() }).strict()
export const videoEditTrackSchema = z.object({ id: identifier, name, index: z.number().int().min(0).max(31), kind: z.enum(['video', 'audio']), locked: z.boolean(), enabled: z.boolean(), muted: z.boolean(), solo: z.boolean() }).strict()
export const videoEditClipSchema = z.object({
  id: identifier, itemId: identifier, name, kind: z.enum(['video', 'audio', 'image', 'text', 'code']), track: z.number().int().min(0).max(31), code: codeMaterialInstanceSchema.optional(),
  start: frame, duration: frame.min(1), sourceInUs: z.number().int().nonnegative(), sourceRemainder,
  x: z.number().finite().min(-2).max(2), y: z.number().finite().min(-2).max(2),
  scale: z.number().min(0.01).max(4), rotation: z.number().min(-360).max(360),
  opacity: z.number().min(0).max(1), volume: z.number().min(0).max(2), brightness: z.number().min(0).max(2), text: z.string().max(2000),
}).strict()
export const videoEditAnnotationSchema = z.object({
  id: identifier, clipId: identifier, frame, space: z.literal('composition-normalized'), kind: z.enum(['point', 'region']),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1), text: z.string().max(2000),
}).strict()
export const videoEditSequenceSchema = z.object({
  id: identifier, name, binId: identifier.optional(), width: z.number().int().min(16).max(4096), height: z.number().int().min(16).max(4096),
  frameRate: videoEditRatioSchema.refine(rate => VIDEO_EDIT_FRAME_RATES.some(value => value.numerator * rate.denominator === rate.numerator * value.denominator), '请选择支持的序列帧率。'),
  pixelAspectRatio: videoEditRatioSchema.refine(ratio => ratio.numerator / ratio.denominator >= 0.25 && ratio.numerator / ratio.denominator <= 4, '像素长宽比超出范围。'),
  sampleRate: z.union([z.literal(44100), z.literal(48000)]), channels: z.union([z.literal(1), z.literal(2)]),
  tracks: z.array(videoEditTrackSchema).min(1).max(32), clips: z.array(videoEditClipSchema).max(500), annotations: z.array(videoEditAnnotationSchema).max(500),
}).strict()
export const videoEditDocumentSchema = z.object({
  format: z.literal('henji-video-project'), version: z.literal(2), id: identifier, name, revision: z.number().int().nonnegative(),
  media: z.array(videoEditMediaSchema).max(200), bins: z.array(videoEditBinSchema).max(200), items: z.array(videoEditItemSchema).max(500), sequences: z.array(videoEditSequenceSchema).min(1).max(32),
  codeMaterials: codeMaterialDefinitionsSchema.optional(),
}).strict().superRefine((document, ctx) => {
  const issue = (message: string): void => { ctx.addIssue({ code: 'custom', message }) }
  const ids = new Set<string>()
  for (const item of [...document.media, ...document.bins, ...document.items, ...(document.codeMaterials ?? []), ...(document.codeMaterials ?? []).flatMap(definition => definition.versions), ...document.sequences, ...document.sequences.flatMap(sequence => [...sequence.tracks, ...sequence.clips, ...sequence.annotations])]) {
    if (ids.has(item.id)) issue('工程包含重复标识。')
    ids.add(item.id)
  }
  for (const bin of document.bins) {
    const chain = new Set([bin.id]); let parentId = bin.parentId
    while (parentId) {
      const parent = document.bins.find(item => item.id === parentId)
      if (!parent || chain.has(parentId)) { issue('素材箱父级不存在或形成循环。'); break }
      chain.add(parentId); parentId = parent.parentId
    }
  }
  for (const item of document.items) {
    if (item.binId && !document.bins.some(bin => bin.id === item.binId)) issue('项目项的素材箱不存在。')
    const media = document.media.find(media => media.id === item.mediaId)
    if (!['text', 'code'].includes(item.kind) && (!media || item.kind !== media.kind)) issue(`项目项 ${item.name} 的素材引用无效。`)
    if (item.kind === 'text' && item.mediaId) issue('文字项目项不能引用媒体文件。')
    if (item.kind === 'code') {
      if (item.mediaId || !item.code) issue('代码项目项必须引用固定源码实例，不能引用预渲染媒体。')
      const definition = document.codeMaterials?.find(value => value.id === item.code?.definitionId)
      if (!definition?.versions.some(version => version.id === item.code?.versionId)) issue('代码项目项的固定源码版本不存在。')
    } else if (item.code) issue('普通项目项不能附带代码生成实例。')
  }
  for (const sequence of document.sequences) {
    if (sequence.binId && !document.bins.some(bin => bin.id === sequence.binId)) issue('序列的素材箱不存在。')
    const fps = videoEditFps(sequence.frameRate)
    if (Math.round(sequence.width * sequence.pixelAspectRatio.numerator / sequence.pixelAspectRatio.denominator) > 8192) issue('等效画面宽度超出导出范围。')
    if (new Set(sequence.tracks.map(track => track.index)).size !== sequence.tracks.length) issue('序列轨道编号重复。')
    for (const clip of sequence.clips) {
      const item = document.items.find(item => item.id === clip.itemId)
      const media = document.media.find(media => media.id === item?.mediaId)
      const track = sequence.tracks.find(track => track.index === clip.track)
      if (!item || item.kind !== clip.kind) issue(`片段 ${clip.name} 的项目项引用无效。`)
      if (clip.kind === 'code') {
        if (!clip.code || clip.code.definitionId !== item?.code?.definitionId || !document.codeMaterials?.find(value => value.id === clip.code?.definitionId)?.versions.some(version => version.id === clip.code?.versionId)) issue('代码片段必须引用所属定义的固定源码版本。')
      } else if (clip.code) issue('普通片段不能附带代码生成实例。')
      if (!track || track.kind !== (clip.kind === 'audio' ? 'audio' : 'video')) issue(`片段 ${clip.name} 的轨道类型不匹配。`)
      if (clip.start + clip.duration > Math.floor(fps * 1800)) issue('序列最长为 30 分钟。')
      if (media && media.kind !== 'image' && videoEditSourceSeconds(clip) + clip.duration / fps > media.durationSeconds + 1 / fps) issue(`片段 ${clip.name} 超出源素材范围。`)
    }
    for (const annotation of sequence.annotations) if (!sequence.clips.some(clip => clip.id === annotation.clipId)) issue('标注的片段不属于此序列。')
  }
})
export type VideoEditDocument = z.infer<typeof videoEditDocumentSchema>
export type VideoEditSequence = z.infer<typeof videoEditSequenceSchema>
export type VideoEditClip = z.infer<typeof videoEditClipSchema>
export type VideoEditMedia = z.infer<typeof videoEditMediaSchema>
export type VideoEditItem = z.infer<typeof videoEditItemSchema>
export type VideoEditBin = z.infer<typeof videoEditBinSchema>
export type VideoEditAnnotation = z.infer<typeof videoEditAnnotationSchema>
export type VideoEditComposition = VideoEditSequence & Pick<VideoEditDocument, 'media' | 'items' | 'revision' | 'codeMaterials'> & { fps: number }
export function createVideoEditSequence(name = '序列 1'): VideoEditSequence {
  return { id: crypto.randomUUID(), name, width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
    tracks: Array.from({ length: 8 }, (_, index) => ({ id: crypto.randomUUID(), name: index === 0 ? '音频 1' : `视频 ${index}`, index, kind: index === 0 ? 'audio' : 'video', locked: false, enabled: true, muted: false, solo: false })), clips: [], annotations: [] }
}
export function createVideoEditDocument(name: string): VideoEditDocument {
  return { format: 'henji-video-project', version: 2, id: crypto.randomUUID(), name, revision: 0, media: [], bins: [], items: [], sequences: [createVideoEditSequence()] }
}
export function videoEditComposition(document: VideoEditDocument, sequenceId: string): VideoEditComposition {
  const sequence = document.sequences.find(item => item.id === sequenceId)
  if (!sequence) throw new Error('目标序列不存在。')
  return { ...sequence, width: Math.round(sequence.width * sequence.pixelAspectRatio.numerator / sequence.pixelAspectRatio.denominator), media: document.media, items: document.items, ...(document.codeMaterials ? { codeMaterials: document.codeMaterials } : {}), revision: document.revision, fps: videoEditFps(sequence.frameRate) }
}
export function videoEditClipMedia(document: Pick<VideoEditComposition, 'media' | 'items'>, clip: VideoEditClip): VideoEditMedia | undefined {
  const item = document.items.find(item => item.id === clip.itemId)
  return document.media.find(media => media.id === item?.mediaId)
}
export function videoEditDuration(document: Pick<VideoEditSequence, 'clips'>): number { return Math.max(1, ...document.clips.map(clip => clip.start + clip.duration)) }
export function clipSourceSeconds(clip: VideoEditClip, timelineFrame: number, fps: number): number { return videoEditSourceSeconds(clip) + (timelineFrame - clip.start) / fps }
export function activeVideoEditClips(document: VideoEditComposition, at: number): VideoEditClip[] {
  return document.clips.filter(clip => at >= clip.start && at < clip.start + clip.duration && document.tracks.some(track => track.index === clip.track && track.enabled)).sort((a, b) => a.track - b.track)
}
export function snapVideoEditFrame(document: Pick<VideoEditSequence, 'clips'>, value: number, excludedId: string, threshold: number): number {
  const candidates = [0, ...document.clips.filter(clip => clip.id !== excludedId).flatMap(clip => [clip.start, clip.start + clip.duration])]
  const nearest = candidates.sort((a, b) => Math.abs(a - value) - Math.abs(b - value))[0]
  return Math.max(0, Math.round(Math.abs(nearest - value) <= threshold ? nearest : value))
}
export function adjustVideoEditClip(document: VideoEditComposition, clip: VideoEditClip, adjustment: { mode: 'move' | 'in' | 'out'; delta: number; track: number; snapThreshold?: number }, codeMetadata?: CodeMaterialMetadataReader): VideoEditClip {
  if (adjustment.mode === 'move') {
    const start = adjustment.snapThreshold === undefined ? Math.max(0, clip.start + adjustment.delta) : snapVideoEditFrame(document, clip.start + adjustment.delta, clip.id, adjustment.snapThreshold)
    return { ...clip, start: Math.min(Math.floor(document.fps * 1800) - clip.duration, start), track: adjustment.track }
  }
  const media = videoEditClipMedia(document, clip)
  const program = clip.code ? codeMetadata?.(clip.code) : undefined
  if (clip.kind === 'code' && !program) throw new Error('代码片段尚未完成源码检查。')
  const timed = clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'code'
  if (adjustment.mode === 'out') {
    const limit = Math.min(Math.floor(document.fps * 1800) - clip.start, program?.mode === 'dynamic' ? Math.floor((program.durationSeconds - videoEditSourceSeconds(clip)) * document.fps + 1e-6) + 1 : timed && media ? Math.floor((media.durationSeconds - videoEditSourceSeconds(clip)) * document.fps + 1e-6) : Infinity)
    return { ...clip, duration: Math.max(1, Math.min(limit, clip.duration + adjustment.delta)) }
  }
  const shift = Math.max(-clip.start, timed ? -Math.floor(videoEditSourceSeconds(clip) * document.fps + 1e-6) : -clip.start, Math.min(clip.duration - 1, adjustment.delta))
  return { ...clip, start: clip.start + shift, duration: clip.duration - shift, ...(timed ? offsetVideoEditSource(clip, shift, document.frameRate) : {}) }
}
export function splitVideoEditClip(sequence: VideoEditSequence, id: string, at: number): VideoEditSequence {
  const clip = sequence.clips.find(item => item.id === id)
  if (!clip || !Number.isInteger(at) || at <= clip.start || at >= clip.start + clip.duration) throw new Error('请将播放头置于片段内部再拆分。')
  const left = at - clip.start
  const right = { ...clip, ...(clip.code ? { code: structuredClone(clip.code) } : {}), id: crypto.randomUUID(), start: at, duration: clip.duration - left, ...offsetVideoEditSource(clip, left, sequence.frameRate) }
  return { ...sequence, clips: sequence.clips.flatMap(item => item.id === id ? [{ ...clip, duration: left }, right] : [item]), annotations: sequence.annotations.map(item => item.clipId === id && item.frame >= at ? { ...item, clipId: right.id } : item) }
}
export function changeVideoEditSequenceSettings(sequence: VideoEditSequence, settings: Partial<Pick<VideoEditSequence, 'width' | 'height' | 'frameRate' | 'pixelAspectRatio' | 'sampleRate' | 'channels'>>): VideoEditSequence {
  const rate = settings.frameRate ?? sequence.frameRate
  const convert = (frame: number): number => rescaleVideoEditFrame(frame, sequence.frameRate, rate)
  if (sequence.clips.some(clip => convert(clip.start + clip.duration) <= convert(clip.start))) throw new Error('新帧率会使部分片段短于一帧。请先调整这些片段的长度，再修改帧率。')
  return videoEditSequenceSchema.parse({ ...sequence, ...settings,
    clips: sequence.clips.map(clip => ({ ...clip, start: convert(clip.start), duration: convert(clip.start + clip.duration) - convert(clip.start) })),
    annotations: sequence.annotations.map(mark => ({ ...mark, frame: convert(mark.frame) })),
  })
}
