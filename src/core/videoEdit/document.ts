import { z } from 'zod'
import { rescaleVideoEditFrame, videoEditFps, videoEditRatioSchema, VIDEO_EDIT_FRAME_RATES } from './time'
import { advanceVideoEditClipSource, splitVideoEditClipSource, videoEditClipHeadRoom, videoEditClipSourceSecondsAt, videoEditClipSpeedSchema, videoEditClipSpeedSupported, videoEditClipSpeedValue, videoEditClipTailRoom, videoEditClipWithinSource } from './clipSpeed'
import { codeMaterialDefinitionsSchema, codeMaterialInstanceSchema } from './codeMaterialPersistence'
import type { CodeMaterialMetadataReader } from './codeMaterialDocument'
import { videoEditMarkerSchema, videoEditCaptionSchema, retimeVideoEditContent } from './timedContent'
import { videoEditGraphicSchema } from './graphics'
import { videoEditAdjustmentSchema, videoEditEffectSchema, validateVideoEditAdjustmentRanges, videoEditEffectAccepts, videoEditEffectCodes, videoEditEffectMedia, VIDEO_EDIT_MAX_EFFECTS } from './compositing'
import { videoEditTransitionSchema, validateVideoEditTransitions } from './transitions'
import { videoEditCreativeSourceSchema } from './creativeResult'
import { videoEditLabelSchema } from './labels'
import { videoEditTrackerSchema, videoEditClipFollowSchema, VIDEO_EDIT_MAX_TRACKERS } from './tracking'
import { videoEditAudioLayoutSchema, videoEditAudioMappingIssue, videoEditAudioMappingSchema, videoEditAudioStreamsSchema } from './audioChannels'
import { videoEditInPlaceRecordsSchema } from './inPlacePersistence'

const frame = z.number().int().min(0).max(108_000)
const identifier = z.string().min(1).max(100)
const name = z.string().trim().min(1).max(200)
const sourceRemainder = z.object({ numerator: z.number().int().nonnegative().max(1_000_000), denominator: z.number().int().positive().max(1_000_000) }).strict().refine(value => value.numerator < value.denominator, '源时间分数必须小于一微秒。')
export const videoEditMediaSchema = z.object({
  id: identifier, name, path: z.string().min(1).max(32768).regex(/^(?:[A-Za-z]:[\\/]|\\\\|\/)/, '素材必须引用本地绝对路径。'),
  kind: z.enum(['video', 'audio', 'image']), durationSeconds: z.number().finite().nonnegative(),
  width: z.number().int().nonnegative(), height: z.number().int().nonnegative(),
  assetId: identifier.optional(), assetContent: z.object({ sizeBytes: z.number().int().nonnegative(), fileModifiedAt: z.number().finite().nonnegative(), contentIdentity: identifier.optional() }).strict().optional(), sourceRevision: identifier.optional(), hasAudio: z.boolean().optional(), frameRate: videoEditRatioSchema.optional(), frameRateMode: z.enum(['sampled-constant', 'variable', 'unknown']).optional(),
  /** Sound streams in file order (task 2.6); absent on media imported before, which plays its first stream. */
  audioStreams: videoEditAudioStreamsSchema.optional(),
}).strict()
export const videoEditBinSchema = z.object({ id: identifier, name, parentId: identifier.optional(), label: videoEditLabelSchema.optional() }).strict()
export const videoEditItemSchema = z.object({ id: identifier, name, binId: identifier.optional(), label: videoEditLabelSchema.optional(), tags: z.array(z.string().trim().min(1).max(80)).max(32).optional(), kind: z.enum(['video', 'audio', 'image', 'text', 'code', 'graphic', 'adjustment']), mediaId: identifier.optional(), code: codeMaterialInstanceSchema.optional(), graphic: videoEditGraphicSchema.optional(), audioChannels: videoEditAudioLayoutSchema.optional() }).strict()
export const videoEditTrackSchema = z.object({ id: identifier, name, index: z.number().int().min(0).max(31), kind: z.enum(['video', 'audio']), locked: z.boolean(), enabled: z.boolean(), muted: z.boolean(), solo: z.boolean(), height: z.number().int().min(24).max(160).optional(), syncLocked: z.boolean().optional() }).strict()
export { videoEditCreativeSourceSchema, type VideoEditCreativeSource } from './creativeResult'
/**
 * 被替换下来的镜头版本（4.12 原地生成的“替换镜头”，PR 的替换素材）：片段换成新画面后仍记着原来用的素材与入点，
 * 可以随时切回。只记引用，不校验素材项是否还在（素材从项目移除后切回时如实拒绝），不参与渲染。
 */
export const VIDEO_EDIT_MAX_CLIP_TAKES = 8
const videoEditClipStateSchema = z.object({
  trackers: z.array(videoEditTrackerSchema).max(VIDEO_EDIT_MAX_TRACKERS).optional(),
  follow: videoEditClipFollowSchema.optional(),
  id: identifier, itemId: identifier, name, kind: z.enum(['video', 'audio', 'image', 'text', 'code', 'graphic', 'adjustment']), track: z.number().int().min(0).max(31), code: codeMaterialInstanceSchema.optional(),
  graphic: videoEditGraphicSchema.optional(), effects: z.array(videoEditEffectSchema).max(VIDEO_EDIT_MAX_EFFECTS).optional(), adjustment: videoEditAdjustmentSchema.optional(),
  linkId: identifier.optional(), groupId: identifier.optional(), sourceComponent: z.enum(['video', 'audio']).optional(), creativeSource: videoEditCreativeSourceSchema.optional(), audioMapping: videoEditAudioMappingSchema.optional(),
  start: frame, duration: frame.min(1), sourceInUs: z.number().int().nonnegative(), sourceRemainder,
  x: z.number().finite().min(-2).max(2), y: z.number().finite().min(-2).max(2),
  scale: z.number().min(0.01).max(4), rotation: z.number().min(-360).max(360),
  opacity: z.number().min(0).max(1), volume: z.number().min(0).max(2), brightness: z.number().min(0).max(2), text: z.string().max(2000),
  /** PR 淡化手柄：片段开头淡入、结尾淡出的帧数（画面从透明渐显，声音按恒定功率渐强）；没有就是不淡化。 */
  fadeInFrames: z.number().int().min(1).max(108_000).optional(), fadeOutFrames: z.number().int().min(1).max(108_000).optional(),
  /**
   * 片段速度（4.13，PR“速度/持续时间”）：倍率有理数，缺省 1；`reverse` 倒放；`preservePitch` 变速时保持音调。
   * 源时间与时间线的换算只在 `clipSpeed.ts`。
   */
  speed: videoEditClipSpeedSchema.optional(), reverse: z.literal(true).optional(), preservePitch: z.literal(true).optional(),
}).strict()
export const videoEditClipTakeSchema = z.object({
  itemId: identifier, name, kind: z.enum(['video', 'audio', 'image']), duration: frame.min(1), sourceInUs: z.number().int().nonnegative(), sourceRemainder,
  sourceComponent: z.enum(['video', 'audio']).optional(), creativeSource: videoEditCreativeSourceSchema.optional(), audioMapping: videoEditAudioMappingSchema.optional(),
  speed: videoEditClipSpeedSchema.optional(), reverse: z.literal(true).optional(), preservePitch: z.literal(true).optional(),
  /** 与镜头一起替换的声音，保留源范围、声道与效果；offset 相对镜头起点，可随移动切回。 */
  linkedAudio: z.array(z.object({ clip: videoEditClipStateSchema, offset: z.number().int() }).strict()).max(32).optional(),
}).strict()
export const videoEditClipSchema = videoEditClipStateSchema.extend({
  takes: z.array(videoEditClipTakeSchema).max(VIDEO_EDIT_MAX_CLIP_TAKES).optional(),
})
export const videoEditAnnotationSchema = z.object({
  id: identifier, clipId: identifier, frame, space: z.literal('composition-normalized'), kind: z.enum(['point', 'region']),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1), text: z.string().max(2000),
}).strict()
export const videoEditSequenceSchema = z.object({
  id: identifier, name, binId: identifier.optional(), label: videoEditLabelSchema.optional(), width: z.number().int().min(16).max(4096), height: z.number().int().min(16).max(4096),
  frameRate: videoEditRatioSchema.refine(rate => VIDEO_EDIT_FRAME_RATES.some(value => value.numerator * rate.denominator === rate.numerator * value.denominator), '请选择支持的序列帧率。'),
  pixelAspectRatio: videoEditRatioSchema.refine(ratio => ratio.numerator / ratio.denominator >= 0.25 && ratio.numerator / ratio.denominator <= 4, '像素长宽比超出范围。'),
  sampleRate: z.union([z.literal(44100), z.literal(48000)]), channels: z.union([z.literal(1), z.literal(2)]),
  tracks: z.array(videoEditTrackSchema).min(1).max(32), clips: z.array(videoEditClipSchema).max(500), annotations: z.array(videoEditAnnotationSchema).max(500),
  markers: z.array(videoEditMarkerSchema).max(500).optional(), captions: z.array(videoEditCaptionSchema).max(500).optional(),
  transitions: z.array(videoEditTransitionSchema).max(500).optional(),
}).strict()
export const videoEditDocumentSchema = z.object({
  format: z.literal('henji-video-project'), version: z.literal(2), id: identifier, name, revision: z.number().int().nonnegative(),
  media: z.array(videoEditMediaSchema).max(200), bins: z.array(videoEditBinSchema).max(200), items: z.array(videoEditItemSchema).max(500), sequences: z.array(videoEditSequenceSchema).min(1).max(32),
  codeMaterials: codeMaterialDefinitionsSchema.optional(),
  /** 用户指定的封面帧（“设为项目封面”）；没有时自动取第一条序列约 1/3 处的画面。 */
  posterFrame: z.object({ sequenceId: identifier, frame: z.number().int().nonnegative() }).strict().optional(),
  /** 原地生成续接元数据，不属于剪辑撤销历史。旧文件可省略。 */
  inPlaceGenerations: videoEditInPlaceRecordsSchema.optional(),
}).strict().superRefine((document, ctx) => {
  const issue = (message: string): void => { ctx.addIssue({ code: 'custom', message }) }
  for (const media of document.media) if (media.assetContent && !media.assetId && !media.assetContent.contentIdentity) issue('原文件内容快照需要固定内容身份。')
  const ids = new Set<string>()
  for (const item of [...document.media, ...document.bins, ...document.items, ...(document.codeMaterials ?? []), ...(document.codeMaterials ?? []).flatMap(definition => definition.versions), ...document.sequences, ...document.sequences.flatMap(sequence => [...sequence.tracks, ...sequence.clips, ...sequence.annotations, ...(sequence.markers ?? []), ...(sequence.captions ?? []), ...(sequence.transitions ?? []), ...sequence.clips.flatMap(clip => clip.effects ?? [])])]) {
    if (ids.has(item.id)) issue('剪辑包含重复标识。')
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
    if (item.binId && !document.bins.some(bin => bin.id === item.binId)) issue('素材项的素材箱不存在。')
    const media = document.media.find(media => media.id === item.mediaId)
    if (!['text', 'code', 'graphic', 'adjustment'].includes(item.kind) && (!media || item.kind !== media.kind)) issue(`素材项 ${item.name} 的素材引用无效。`)
    if (['text', 'graphic', 'adjustment'].includes(item.kind) && item.mediaId) issue('文字、图形及调整图层不能引用媒体文件。')
    if (item.kind === 'graphic' ? !item.graphic : Boolean(item.graphic)) issue('只有图形素材项可以且必须保存结构化图形。')
    if (item.kind === 'code') {
      if (item.mediaId || !item.code) issue('代码素材项必须引用固定源码实例，不能引用预渲染媒体。')
      const definition = document.codeMaterials?.find(value => value.id === item.code?.definitionId)
      if (!definition?.versions.some(version => version.id === item.code?.versionId)) issue('代码素材项的固定源码版本不存在。')
    } else if (item.code) issue('普通素材项不能附带代码生成实例。')
    if (item.audioChannels) {
      if (!media || !(item.kind === 'audio' || item.kind === 'video' && media.hasAudio !== false)) issue('只有带声音的音视频素材项可以设置音频声道。')
      for (const mapping of item.audioChannels) { const problem = videoEditAudioMappingIssue(mapping, media?.audioStreams); if (problem) issue(problem) }
    }
  }
  for (const sequence of document.sequences) {
    if (sequence.binId && !document.bins.some(bin => bin.id === sequence.binId)) issue('序列的素材箱不存在。')
    const fps = videoEditFps(sequence.frameRate)
    if (Math.round(sequence.width * sequence.pixelAspectRatio.numerator / sequence.pixelAspectRatio.denominator) > 8192) issue('等效画面宽度超出导出范围。')
    if (new Set(sequence.tracks.map(track => track.index)).size !== sequence.tracks.length) issue('序列轨道编号重复。')
    for (const clip of sequence.clips) {
      if (clip.trackers?.length && clip.kind !== 'video' && clip.kind !== 'image') issue('跟踪器只能放在视频或图片片段上。')
      if (new Set(clip.trackers?.map(tracker => tracker.id)).size !== (clip.trackers?.length ?? 0)) issue(`片段“${clip.name}”的跟踪器 ID 重复。`)
      const item = document.items.find(item => item.id === clip.itemId)
      const media = document.media.find(media => media.id === item?.mediaId)
      const track = sequence.tracks.find(track => track.index === clip.track)
      const extractedAudio = item?.kind === 'video' && clip.kind === 'audio' && clip.sourceComponent === 'audio'
      if (!item || (item.kind !== clip.kind && !extractedAudio)) issue(`片段 ${clip.name} 的素材项引用无效。`)
      if (clip.sourceComponent && !(item?.kind === 'video' && ((clip.kind === 'video' && clip.sourceComponent === 'video') || extractedAudio))) issue('只有视频素材可以拆开引用画面或声音。')
      if (extractedAudio && media?.hasAudio !== true) issue('拆出的声音必须引用已确认具有音轨的视频素材。')
      if (clip.audioMapping) {
        if (!media || !(clip.kind === 'audio' || clip.kind === 'video' && clip.sourceComponent !== 'video')) issue('只有发声的音视频片段可以设置声道映射。')
        const problem = videoEditAudioMappingIssue(clip.audioMapping, media?.audioStreams); if (problem) issue(problem)
      }
      if (clip.kind === 'code') {
        if (!clip.code || clip.code.definitionId !== item?.code?.definitionId || !document.codeMaterials?.find(value => value.id === clip.code?.definitionId)?.versions.some(version => version.id === clip.code?.versionId)) issue('代码片段必须引用所属定义的固定源码版本。')
      } else if (clip.code) issue('普通片段不能附带代码生成实例。')
      if (clip.kind === 'graphic' ? !clip.graphic : Boolean(clip.graphic)) issue('只有图形片段可以且必须保存结构化图形。')
      if (clip.kind === 'adjustment' ? !clip.adjustment : Boolean(clip.adjustment)) issue('只有调整图层可以且必须保存作用范围。')
      for (const effect of clip.effects ?? []) {
        const media = videoEditEffectMedia(effect)
        if (!videoEditEffectAccepts(media, clip)) { issue(media === 'audio' ? '音频效果只能加到声音片段。' : '画面效果不能附加到声音片段。'); break }
      }
      for (const code of videoEditEffectCodes(clip.effects)) if (!document.codeMaterials?.find(definition => definition.id === code.definitionId)?.versions.some(version => version.id === code.versionId)) issue('附加效果的固定源码版本不存在。')
      if (!track || track.kind !== (clip.kind === 'audio' ? 'audio' : 'video')) issue(`片段 ${clip.name} 的轨道类型不匹配。`)
      if (clip.start + clip.duration > Math.floor(fps * 1800)) issue('序列最长为 30 分钟。')
      if ((clip.speed || clip.reverse || clip.preservePitch) && !videoEditClipSpeedSupported(clip.kind)) issue(`片段 ${clip.name} 不能改速度或倒放。`)
      if (media && media.kind !== 'image' && !videoEditClipWithinSource(clip, fps, media.durationSeconds, Math.max(1, videoEditClipSpeedValue(clip)) / fps)) issue(`片段 ${clip.name} 超出源素材范围。`)
    }
    for (const annotation of sequence.annotations) if (!sequence.clips.some(clip => clip.id === annotation.clipId)) issue('标注的片段不属于此序列。')
    for (const marker of sequence.markers ?? []) {
      const clip = sequence.clips.find(clip => clip.id === marker.clipId)
      if (marker.frame >= Math.floor(fps * 1800) || marker.clipId && (!clip || marker.frame < clip.start || marker.frame >= clip.start + clip.duration)) issue('标记须位于序列或所属片段的半开范围内。')
    }
    for (const caption of sequence.captions ?? []) {
      const clip = sequence.clips.find(clip => clip.id === caption.clipId)
      if (caption.start + caption.duration > Math.floor(fps * 1800) || caption.clipId && (!clip || caption.start < clip.start || caption.start + caption.duration > clip.start + clip.duration)) issue('字幕须位于序列或所属片段的半开范围内。')
    }
    const edges = (sequence.captions ?? []).flatMap(caption => [{ at: caption.start, delta: 1 }, { at: caption.start + caption.duration, delta: -1 }]).sort((a, b) => a.at - b.at || a.delta - b.delta)
    let activeCaptions = 0
    for (const edge of edges) { activeCaptions += edge.delta; if (activeCaptions > 8) { issue('同一时刻最多显示8段字幕。'); break } }
    try { validateVideoEditAdjustmentRanges(sequence) } catch (error) { issue(error instanceof Error ? error.message : '调整图层范围无效。') }
  }
  try { validateVideoEditTransitions(document) } catch (error) { issue(error instanceof Error ? error.message : '转场范围无效。') }
})
export type VideoEditDocument = z.infer<typeof videoEditDocumentSchema>
export type VideoEditSequence = z.infer<typeof videoEditSequenceSchema>
export type VideoEditClip = z.infer<typeof videoEditClipSchema>
export type VideoEditClipTake = z.infer<typeof videoEditClipTakeSchema>
export type VideoEditMedia = z.infer<typeof videoEditMediaSchema>
export type VideoEditItem = z.infer<typeof videoEditItemSchema>
export type VideoEditBin = z.infer<typeof videoEditBinSchema>
export type VideoEditAnnotation = z.infer<typeof videoEditAnnotationSchema>
export type VideoEditComposition = VideoEditSequence & Pick<VideoEditDocument, 'media' | 'items' | 'revision' | 'codeMaterials'> & { fps: number }
export function createVideoEditSequence(name = '序列 1'): VideoEditSequence {
  return { id: crypto.randomUUID(), name, width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
    // 新序列与 PR 一样只有一条视频轨（V1）和一条音频轨（A1）；需要更多轨道时拖到轨道外或用轨道头菜单添加。
    tracks: Array.from({ length: 2 }, (_, index) => ({ id: crypto.randomUUID(), name: index === 0 ? '音频 1' : '视频 1', index, kind: index === 0 ? 'audio' : 'video', locked: false, enabled: true, muted: false, solo: false })), clips: [], annotations: [] }
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
export function videoEditDuration(document: Pick<VideoEditSequence, 'clips' | 'captions' | 'markers'>): number { return Math.max(1, ...document.clips.map(clip => clip.start + clip.duration), ...(document.captions ?? []).map(caption => caption.start + caption.duration), ...(document.markers ?? []).map(marker => marker.frame + 1)) }
/** 时间线帧 `timelineFrame` 上片段显示的源时间（秒），按片段速度与倒放换算（`clipSpeed.ts`）。 */
export function clipSourceSeconds(clip: VideoEditClip, timelineFrame: number, fps: number): number { return videoEditClipSourceSecondsAt(clip, timelineFrame, fps) }
export function videoEditVisibleTracks(document: Pick<VideoEditSequence, 'tracks'>): Set<number> {
  const solo = document.tracks.some(track => track.kind === 'video' && track.enabled && track.solo)
  return new Set(document.tracks.filter(track => track.enabled && (track.kind === 'audio' || !solo || track.solo)).map(track => track.index))
}
export function activeVideoEditClips(document: VideoEditComposition, at: number): VideoEditClip[] {
  const visible = videoEditVisibleTracks(document)
  return document.clips.filter(clip => at >= clip.start && at < clip.start + clip.duration && visible.has(clip.track)).sort((a, b) => a.track - b.track)
}
export function audibleVideoEditClips(document: VideoEditComposition): VideoEditClip[] {
  const candidates = document.clips.filter(clip => (clip.kind === 'video' || clip.kind === 'audio') && clip.sourceComponent !== 'video' && clip.volume > 0)
  const tracks = new Map(document.tracks.map(track => [track.index, track]))
  const solo = candidates.some(clip => { const track = tracks.get(clip.track); return track?.enabled && track.solo })
  return candidates.filter(clip => { const track = tracks.get(clip.track); return track?.enabled && !track.muted && (!solo || track.solo) })
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
  const timed = ['video', 'audio', 'code', 'graphic', 'adjustment'].includes(clip.kind) || Boolean(clip.effects?.length)
  if (adjustment.mode === 'out') {
    const limit = Math.min(Math.floor(document.fps * 1800) - clip.start, program?.mode === 'dynamic' ? clip.duration + videoEditClipTailRoom(clip, document.fps, program.durationSeconds) + 1 : timed && media ? clip.duration + videoEditClipTailRoom(clip, document.fps, media.durationSeconds) : Infinity)
    return { ...clip, duration: Math.max(1, Math.min(limit, clip.duration + adjustment.delta)) }
  }
  const shift = Math.max(-clip.start, timed ? -videoEditClipHeadRoom(clip, document.fps, program?.mode === 'dynamic' ? program.durationSeconds : media?.durationSeconds) : -clip.start, Math.min(clip.duration - 1, adjustment.delta))
  return { ...clip, start: clip.start + shift, duration: clip.duration - shift, ...(timed ? advanceVideoEditClipSource(clip, shift, document.frameRate) : {}) }
}
export function splitVideoEditClip(sequence: VideoEditSequence, id: string, at: number): VideoEditSequence {
  const clip = sequence.clips.find(item => item.id === id)
  if (!clip || !Number.isInteger(at) || at <= clip.start || at >= clip.start + clip.duration) throw new Error('请将播放头置于片段内部再拆分。')
  const left = at - clip.start
  const right = { ...clip, ...(clip.code ? { code: structuredClone(clip.code) } : {}), ...(clip.graphic ? { graphic: structuredClone(clip.graphic) } : {}), ...(clip.effects ? { effects: clip.effects.map(effect => ({ ...structuredClone(effect), id: crypto.randomUUID() })) } : {}), id: crypto.randomUUID(), start: at, duration: clip.duration - left, ...splitVideoEditClipSource(clip, left, sequence.frameRate) }
  // 淡入留在左半段开头、淡出留在右半段结尾（PR 拆分后淡化手柄跟着原片段的首尾）。
  delete right.fadeInFrames
  const leftPart = { ...clip, duration: left }; delete leftPart.fadeOutFrames
  const next = { ...sequence, clips: sequence.clips.flatMap(item => item.id === id ? [leftPart, right] : [item]), annotations: sequence.annotations.map(item => item.clipId === id && item.frame >= at ? { ...item, clipId: right.id } : item) }
  const origins = new Map([[right.id, { originalId: id, shift: 0 }], [id, { originalId: id, shift: 0 }]])
  return retimeVideoEditContent(sequence, next, origins)
}
export function changeVideoEditSequenceSettings(sequence: VideoEditSequence, settings: Partial<Pick<VideoEditSequence, 'width' | 'height' | 'frameRate' | 'pixelAspectRatio' | 'sampleRate' | 'channels'>>): VideoEditSequence {
  const rate = settings.frameRate ?? sequence.frameRate
  const convert = (frame: number): number => rescaleVideoEditFrame(frame, sequence.frameRate, rate)
  if (sequence.clips.some(clip => convert(clip.start + clip.duration) <= convert(clip.start))) throw new Error('新帧率会使部分片段短于一帧。请先调整这些片段的长度，再修改帧率。')
  return videoEditSequenceSchema.parse({ ...sequence, ...settings,
    clips: sequence.clips.map(clip => ({ ...clip, start: convert(clip.start), duration: convert(clip.start + clip.duration) - convert(clip.start), ...(clip.fadeInFrames ? { fadeInFrames: Math.max(1, convert(clip.fadeInFrames)) } : {}), ...(clip.fadeOutFrames ? { fadeOutFrames: Math.max(1, convert(clip.fadeOutFrames)) } : {}) })),
    annotations: sequence.annotations.map(mark => ({ ...mark, frame: convert(mark.frame) })),
    ...(sequence.markers ? { markers: sequence.markers.map(mark => ({ ...mark, frame: convert(mark.frame) })) } : {}),
    ...(sequence.captions ? { captions: sequence.captions.map(caption => ({ ...caption, start: convert(caption.start), duration: convert(caption.start + caption.duration) - convert(caption.start) })) } : {}),
    ...(sequence.transitions ? { transitions: sequence.transitions.map(transition => ({ ...transition, durationFrames: convert(transition.durationFrames), ...(transition.framesBeforeCut !== undefined ? { framesBeforeCut: Math.min(convert(transition.durationFrames), convert(transition.framesBeforeCut)) } : {}) })) } : {}),
  })
}
