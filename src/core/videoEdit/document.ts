import { videoEditGainDbSchema } from './loudness'
import { videoEditExportSettingsSchema } from './exportPresets'
import { videoEditAnnotationSchema, mapVideoEditAnnotationTime } from './annotations'
export { videoEditAnnotationSchema } from './annotations'
import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS, VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from './time'
import { z } from 'zod'
import { isVideoEditSequenceSize, videoEditSequenceSizeFields } from './sequenceSize'
import { rescaleVideoEditFrame, videoEditFps, videoEditRatioSchema, VIDEO_EDIT_FRAME_RATES } from './time'
import { advanceVideoEditClipSource, splitVideoEditClipSource, videoEditClipHeadRoom, videoEditClipSourceSecondsAt, videoEditClipSpeedSchema, videoEditClipSpeedSupported, videoEditClipSpeedValue, videoEditClipTailRoom, videoEditClipWithinSource } from './clipSpeed'
import { codeMaterialDefinitionsSchema, codeMaterialInstanceSchema } from './codeMaterialPersistence'
import { videoEditFrameInterpolationSchema, videoEditTimeRemapSchema } from './timeRemap'
import { codeElementOverridesSchema } from './codeElementOverrides'
import type { CodeMaterialMetadataReader } from './codeMaterialDocument'
import { videoEditMarkerSchema, videoEditCaptionSchema, retimeVideoEditContent } from './timedContent'
import { projectVideoEditNestedCaptions, projectVideoEditNestedContentClips } from './nestedCaptions'
import { videoEditContentAnchorSchema, sliceVideoEditContentAnchor, assertVideoEditContentAnchors } from './contentAnchors'
import { videoEditGraphicSchema } from './graphics'
import { videoEditAdjustmentSchema, videoEditEffectSchema, validateVideoEditAdjustmentRanges, videoEditEffectAccepts, videoEditEffectCodes, videoEditEffectMedia } from './compositing'
import { videoEditTransitionSchema, validateVideoEditTransitions, resizeVideoEditTransition } from './transitions'
import { videoEditCreativeSourceSchema } from './creativeResult'
import { videoEditCodeImageGenerationSchema } from './codeImageGeneration'
import { videoEditLabelSchema } from './labels'
import { videoEditTrackerSchema, videoEditClipFollowSchema, VIDEO_EDIT_MAX_TRACKERS } from './tracking'
import { videoEditClipStabilizationSchema } from './stabilization'
import { videoEditAudioLayoutSchema, videoEditAudioMappingIssue, videoEditAudioMappingSchema, videoEditAudioStreamsSchema } from './audioChannels'
import { videoEditInPlaceRecordsSchema } from './inPlacePersistence'
import { videoEditClipCurvesSchema, assertVideoEditKeyframeTimes, sliceVideoEditClipKeyframes, rescaleVideoEditClipKeyframes, VIDEO_EDIT_ANIMATABLE_KEYS, videoEditClipAnimatedValueSchemas, videoEditKeyframeValues } from './keyframes'
import { videoEditTextStyleSchema } from './text'
import { colorLutAssetSchema } from './colorLutAsset'
import { videoEditAudioRoleSchema } from './audioDucking'
import { assertVideoEditSequenceGraph } from './sequenceGraph'
import { videoEditTextTranscriptionSchema } from './textTranscriptionSchema'
import { videoEditMulticamSchema } from './multicamSchema'
import { videoEditStyleSchema, videoEditStyleIdSchema, videoEditTemplateMetaShape, videoEditTemplateOriginSchema } from './styles/styleSchemas'
import { creativeIntentsSchema } from '../creativeIntent/persistence'
import { recordingCursorSourceSchema, RECORDING_CURSOR_EFFECT } from './recordingCursor'
import { RECORDING_ZOOM_EFFECT } from './recordingZoom'
import { VIDEO_EDIT_DOCUMENT_VERSION } from '../persistence/schemaVersions'
import { videoEditClipRemixSchema } from './musicRemix'

const frame = z.number().int().min(0).max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES)
const identifier = z.string().min(1).max(100)
const name = z.string().trim().min(1).max(200)
export const videoEditIntrinsicSectionSchema = z.enum(['motion', 'opacity', 'audio', 'text', 'textStyle'])
export type VideoEditIntrinsicSection = z.infer<typeof videoEditIntrinsicSectionSchema>
const sourceRemainder = z.object({ numerator: z.number().int().nonnegative().max(1_000_000), denominator: z.number().int().positive().max(1_000_000) }).strict().refine(value => value.numerator < value.denominator, '源时间分数必须小于一微秒。')
export const videoEditMediaSchema = z.object({
  recordingCursor: recordingCursorSourceSchema.optional(),
  id: identifier, name, path: z.string().min(1).max(32768).regex(/^(?:[A-Za-z]:[\\/]|\\\\|\/)/, '素材必须引用本地绝对路径。'),
  kind: z.enum(['video', 'audio', 'image']), durationSeconds: z.number().finite().nonnegative(),
    codeImageGeneration: videoEditCodeImageGenerationSchema.optional(),
    creativeSource: videoEditCreativeSourceSchema.optional(),
  width: z.number().int().nonnegative(), height: z.number().int().nonnegative(),
  assetId: identifier.optional(), assetContent: z.object({ sizeBytes: z.number().int().nonnegative(), fileModifiedAt: z.number().finite().nonnegative(), contentIdentity: identifier.optional() }).strict().optional(), sourceRevision: identifier.optional(), hasAudio: z.boolean().optional(), frameRate: videoEditRatioSchema.optional(), frameRateMode: z.enum(['sampled-constant', 'variable', 'unknown']).optional(),
  /** Sound streams in file order (task 2.6); absent on media imported before, which plays its first stream. */
  audioStreams: videoEditAudioStreamsSchema.optional(),
}).strict()
export const videoEditBinSchema = z.object({ id: identifier, name, parentId: identifier.optional(), label: videoEditLabelSchema.optional(), sourceFolderPath: z.string().min(1).optional() }).strict()
export const videoEditItemSourceRangeSchema = z.object({ inUs: z.number().int().nonnegative(), outUs: z.number().int().positive() }).strict().refine(value => value.outUs > value.inUs, '子剪辑出点须晚于入点。')
export const videoEditItemSchema = z.object({ id: identifier, name, binId: identifier.optional(), label: videoEditLabelSchema.optional(), tags: z.array(z.string().trim().min(1).max(80)).optional(), kind: z.enum(['video', 'audio', 'image', 'text', 'code', 'graphic', 'adjustment', 'sequence']), sequenceId: identifier.optional(), mediaId: identifier.optional(), code: codeMaterialInstanceSchema.optional(), elementOverrides: codeElementOverridesSchema.optional(), graphic: videoEditGraphicSchema.optional(), audioChannels: videoEditAudioLayoutSchema.optional(), sourceRange: videoEditItemSourceRangeSchema.optional() }).strict()
export const videoEditTrackSchema = z.object({ id: identifier, name, index: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), kind: z.enum(['video', 'audio']), locked: z.boolean(), enabled: z.boolean(), muted: z.boolean(), solo: z.boolean(), height: z.number().int().min(24).max(160).optional(), syncLocked: z.boolean().optional() }).strict()
export { videoEditCreativeSourceSchema, type VideoEditCreativeSource } from './creativeResult'
/**
 * 被替换下来的镜头版本（4.12 原地生成的“替换镜头”，PR 的替换素材）：片段换成新画面后仍记着原来用的素材与入点，
 * 可以随时切回。只记引用，不校验素材项是否还在（素材从项目移除后切回时如实拒绝），不参与渲染。
 */
/** 速度曲线、补帧与变调（剪辑内容第 19 版新增的可选字段），片段与镜头版本共用。 */
function videoEditClipTimingExtensionFields() {
  return { timeRemap: videoEditTimeRemapSchema.optional(), frameInterpolation: videoEditFrameInterpolationSchema.optional(), pitchSemitones: z.number().finite().min(-24).max(24).optional() }
}
const videoEditClipStateSchema = z.object({
  multicamCameraId: identifier.optional(),
  trackers: z.array(videoEditTrackerSchema).max(VIDEO_EDIT_MAX_TRACKERS).optional(),
  follow: videoEditClipFollowSchema.optional(),
  /** 防抖参数（平滑程度、最大裁切、是否校正旋转与缩放）；相机运动分析按素材内容缓存，渲染时实时修正。 */
  stabilization: videoEditClipStabilizationSchema.optional(),
  contentAnchor: videoEditContentAnchorSchema.optional(),
  snapToBeat: z.boolean().optional().describe('超级关键帧整理时吸附到序列节拍标记，钉点优先。'),
  /** 原生模板实例：同一模板的文字图形片段联动；分离后去掉。代码模板靠代码定义联动，不写这一项。 */
  templateId: identifier.optional(),
  id: identifier, itemId: identifier, name, kind: z.enum(['video', 'audio', 'image', 'text', 'code', 'graphic', 'adjustment', 'sequence']), track: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), code: codeMaterialInstanceSchema.optional(),
  elementOverrides: codeElementOverridesSchema.optional(),
  graphic: videoEditGraphicSchema.optional(), effects: z.array(videoEditEffectSchema).optional(), adjustment: videoEditAdjustmentSchema.optional(),
  effectsEnabled: z.boolean().optional(),
  disabledIntrinsicSections: z.array(videoEditIntrinsicSectionSchema).refine(values => new Set(values).size === values.length, '固有分区不能重复。').optional(),
  linkId: identifier.optional(), groupId: identifier.optional(), sourceComponent: z.enum(['video', 'audio']).optional(), creativeSource: videoEditCreativeSourceSchema.optional(), audioMapping: videoEditAudioMappingSchema.optional(),
  start: frame, duration: frame.min(1), sourceInUs: z.number().int().nonnegative(), sourceRemainder,
  x: videoEditClipAnimatedValueSchemas.x, y: videoEditClipAnimatedValueSchemas.y,
  scale: videoEditClipAnimatedValueSchemas.scale, rotation: videoEditClipAnimatedValueSchemas.rotation,
  anchorX: videoEditClipAnimatedValueSchemas.anchorX.optional(), anchorY: videoEditClipAnimatedValueSchemas.anchorY.optional(), curves: videoEditClipCurvesSchema.optional(),
  opacity: videoEditClipAnimatedValueSchemas.opacity, volume: videoEditClipAnimatedValueSchemas.volume, gainDb: videoEditGainDbSchema.optional(), audioRole: videoEditAudioRoleSchema.optional(), text: z.string().max(2000),
  textStyle: videoEditTextStyleSchema.optional(),
  /** PR 淡化手柄：片段开头淡入、结尾淡出的帧数（画面从透明渐显，声音按恒定功率渐强）；没有就是不淡化。 */
  fadeInFrames: z.number().int().min(1).max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES).optional(), fadeOutFrames: z.number().int().min(1).max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES).optional(),
  /**
   * 片段速度（4.13，PR“速度/持续时间”）：倍率有理数，缺省 1；`reverse` 倒放；`preservePitch` 变速时保持音调。
   * 源时间与时间线的换算只在 `clipSpeed.ts`。
   */
  speed: videoEditClipSpeedSchema.optional(), reverse: z.literal(true).optional(), preservePitch: z.literal(true).optional(),
  frameHold: z.literal(true).optional(),
  /** 时间重映射（速度曲线，见 timeRemap.ts），与 `speed`、`frameHold` 互斥；`frameInterpolation` 补帧方式；`pitchSemitones` 变调（半音）。 */
  ...videoEditClipTimingExtensionFields(),
  /** 音频重构（PR“重新混合”）生成的子片段：记录同一次重构的参数与原始源范围，改参数时据此重算。 */
  remix: videoEditClipRemixSchema.optional(),
}).strict()
export const videoEditClipTakeSchema = z.object({
  frameHold: z.literal(true).optional(),
  itemId: identifier, name, kind: z.enum(['video', 'audio', 'image']), duration: frame.min(1), sourceInUs: z.number().int().nonnegative(), sourceRemainder,
  sourceComponent: z.enum(['video', 'audio']).optional(), creativeSource: videoEditCreativeSourceSchema.optional(), audioMapping: videoEditAudioMappingSchema.optional(),
  speed: videoEditClipSpeedSchema.optional(), reverse: z.literal(true).optional(), preservePitch: z.literal(true).optional(),
  ...videoEditClipTimingExtensionFields(),
  /** 与镜头一起替换的声音，保留源范围、声道与效果；offset 相对镜头起点，可随移动切回。 */
  linkedAudio: z.array(z.object({ clip: videoEditClipStateSchema, offset: z.number().int() }).strict()).optional(),
}).strict()
export const videoEditClipSchema = videoEditClipStateSchema.extend({
  takes: z.array(videoEditClipTakeSchema).optional(),
})
/** 原生模板的内容：自成一体的文字与图形片段快照（start/track 相对组合起点），不带媒体、代码、跟踪或效果。 */
export const videoEditNativeTemplateClipSchema = videoEditClipSchema.pick({ name: true, kind: true, track: true, start: true, duration: true, sourceInUs: true, sourceRemainder: true, x: true, y: true, scale: true, rotation: true, anchorX: true, anchorY: true, opacity: true, volume: true, text: true, textStyle: true, graphic: true, curves: true }).strip().superRefine((clip, ctx) => {
  if (clip.kind !== 'graphic' && clip.kind !== 'text' || clip.kind === 'graphic' && !clip.graphic) ctx.addIssue({ code: 'custom', message: '原生模板只接受文字或图形片段。' })
})
export const videoEditNativeTemplateContentSchema = z.object({ width: z.number().int().min(16).max(8192), height: z.number().int().min(16).max(8192), fps: z.number().finite().positive().max(120), clips: z.array(videoEditNativeTemplateClipSchema).min(1) }).strict()
export const videoEditNativeTemplateBodySchema = z.object({ kind: z.literal('native'), content: videoEditNativeTemplateContentSchema }).strict()
/** 工程模板：代码模板的源码就是工程里那份代码定义（不另存一份），origin 记录复制自哪个库模板及其版本。 */
export const videoEditProjectTemplateSchema = z.object({
  ...videoEditTemplateMetaShape,
  origin: videoEditTemplateOriginSchema.nullable(),
  body: z.discriminatedUnion('kind', [z.object({ kind: z.literal('code'), definitionId: identifier }).strict(), videoEditNativeTemplateBodySchema]),
}).strict()
export type VideoEditProjectTemplate = z.infer<typeof videoEditProjectTemplateSchema>
export type VideoEditNativeTemplateContent = z.infer<typeof videoEditNativeTemplateContentSchema>
export type VideoEditNativeTemplateClip = z.infer<typeof videoEditNativeTemplateClipSchema>
export const videoEditSequenceSchema = z.object({
  /** 序列按哪份工程风格副本创作（`styles` 中的 id）；绑定不改时间线上的任何东西。 */
  styleId: videoEditStyleIdSchema.optional(),
  multicam: videoEditMulticamSchema.optional(),
  textTranscription: videoEditTextTranscriptionSchema.optional(),
  id: identifier, name, binId: identifier.optional(), label: videoEditLabelSchema.optional(), ...videoEditSequenceSizeFields,
  frameRate: videoEditRatioSchema.refine(rate => VIDEO_EDIT_FRAME_RATES.some(value => value.numerator * rate.denominator === rate.numerator * value.denominator), '请选择支持的序列帧率。'),
  pixelAspectRatio: videoEditRatioSchema.refine(ratio => ratio.numerator / ratio.denominator >= 0.25 && ratio.numerator / ratio.denominator <= 4, '像素长宽比超出范围。'),
  sampleRate: z.union([z.literal(44100), z.literal(48000)]), channels: z.union([z.literal(1), z.literal(2)]),
  tracks: z.array(videoEditTrackSchema).min(1), clips: z.array(videoEditClipSchema), annotations: z.array(videoEditAnnotationSchema),
  markers: z.array(videoEditMarkerSchema).optional(), captions: z.array(videoEditCaptionSchema).optional(),
  captionTrackEnabled: z.boolean().optional().describe('字幕轨道是否输出到节目画面，省略时显示。'),
  captionTrackLocked: z.boolean().optional().describe('锁定字幕轨道后禁止修改、添加或删除字幕，省略时未锁定。'),
  transitions: z.array(videoEditTransitionSchema).optional(),
}).strict().refine(isVideoEditSequenceSize, '超过 8K 上限。')
export const videoEditExportHistorySchema = z.array(z.object({
  id: z.string().min(1), taskId: z.string().min(1), sequenceId: z.string().min(1), name: z.string(), presetName: z.string(),
  path: z.string().min(1), completedAt: z.number().finite().nonnegative(), rangeSource: z.enum(['explicit', 'in-out', 'content']),
  settings: videoEditExportSettingsSchema, range: z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict(),
  assetRef: z.object({ kind: z.literal('asset'), id: z.string().min(1) }).strict().optional(),
}).strict())
export type VideoEditExportHistoryEntry = z.infer<typeof videoEditExportHistorySchema>[number]
export const videoEditDocumentSchema = z.object({
  exportHistory: videoEditExportHistorySchema.optional(),
  creativeIntents: creativeIntentsSchema.optional(),
  /** 工程风格副本：绑定时从风格库复制，与库里同一 id；库里有更新版本时只提示，用户同意后才升级。 */
  styles: z.array(videoEditStyleSchema).optional(),
  /** 工程模板（剪辑内容第 22 版）：代码模板联动同一代码定义的全部片段，原生模板联动 templateId 相同的文字图形片段。 */
  templates: z.array(videoEditProjectTemplateSchema).optional(),
  colorLuts: z.array(colorLutAssetSchema).optional(),
  format: z.literal('henji-video-project'), version: z.literal(VIDEO_EDIT_DOCUMENT_VERSION), id: identifier, name, revision: z.number().int().nonnegative(),
  media: z.array(videoEditMediaSchema), bins: z.array(videoEditBinSchema), items: z.array(videoEditItemSchema), sequences: z.array(videoEditSequenceSchema),
  codeMaterials: codeMaterialDefinitionsSchema.optional(),
  /** 放入与身份同事务保存；回执丢失时核对实际落位，随内容一起撤销。 */
  creativePlacements: z.array(z.object({ operationId: z.string().uuid(), sequenceId: identifier, assetId: identifier,
    itemId: identifier, clipId: z.string().max(100) }).strict()).optional(),
  /** 用户指定的封面帧（“设为项目封面”）；没有时自动取第一条序列约 1/3 处的画面。 */
  posterFrame: z.object({ sequenceId: identifier, frame: z.number().int().nonnegative() }).strict().optional(),
  /** 原地生成续接元数据，不属于剪辑撤销历史。旧文件可省略。 */
  inPlaceGenerations: videoEditInPlaceRecordsSchema.optional(),
}).strict().superRefine((document, ctx) => {
  const issue = (message: string): void => { ctx.addIssue({ code: 'custom', message }) }
  const mediaById = new Map(document.media.map(value => [value.id, value]))
  const binsById = new Map(document.bins.map(value => [value.id, value]))
  const itemsById = new Map(document.items.map(value => [value.id, value]))
  const sequencesById = new Map(document.sequences.map(value => [value.id, value]))
  const definitionsById = new Map(document.codeMaterials?.map(value => [value.id, value]))
  const styleIds = new Set(document.styles?.map(value => value.id))
  if (styleIds.size !== (document.styles?.length ?? 0)) issue('工程风格副本标识不能重复。')
  for (const sequence of document.sequences) if (sequence.styleId && !styleIds.has(sequence.styleId)) issue('序列的风格引用不存在。')
  const nativeTemplates = new Set(document.templates?.filter(template => template.body.kind === 'native').map(template => template.id))
  for (const template of document.templates ?? []) if (template.body.kind === 'code' && !definitionsById.has(template.body.definitionId)) issue(`模板“${template.name}”的代码定义不存在。`)
  if (new Set(document.templates?.map(template => template.body.kind === 'code' ? template.body.definitionId : template.id)).size !== (document.templates?.length ?? 0)) issue('一份代码定义只能登记为一个模板。')
  for (const sequence of document.sequences) for (const clip of sequence.clips) if (clip.templateId && !nativeTemplates.has(clip.templateId)) issue('片段引用的原生模板不存在。')
  const lutsById = new Set(document.colorLuts?.map(value => value.id))
  for (const media of document.media) if (media.assetContent && !media.assetId && !media.assetContent.contentIdentity) issue('原文件内容快照需要固定内容身份。')
  const ids = new Set<string>()
  for (const item of [...(document.styles ?? []), ...(document.templates ?? []), ...(document.colorLuts ?? []), ...document.media, ...document.bins, ...document.items, ...(document.codeMaterials ?? []), ...(document.codeMaterials ?? []).flatMap(definition => definition.versions), ...document.sequences, ...document.sequences.flatMap(sequence => [...sequence.tracks, ...sequence.clips, ...sequence.annotations, ...(sequence.markers ?? []), ...(sequence.captions ?? []), ...(sequence.transitions ?? []), ...sequence.clips.flatMap(clip => clip.effects ?? [])])]) {
    if (ids.has(item.id)) issue('剪辑包含重复标识。')
    ids.add(item.id)
  }
  const checkedBins = new Set<string>()
  for (const bin of document.bins) {
    const chain = new Set([bin.id]); let parentId = bin.parentId
    while (parentId && !checkedBins.has(parentId)) {
      const parent = binsById.get(parentId)
      if (!parent || chain.has(parentId)) { issue('素材箱父级不存在或形成循环。'); break }
      chain.add(parentId); parentId = parent.parentId
    }
    for (const id of chain) checkedBins.add(id)
  }
  for (const item of document.items) {
    if (item.elementOverrides && item.kind !== 'code') issue('初始元素覆盖只能用于代码素材项。')
    if (item.kind === 'sequence') {
      if (!sequencesById.has(item.sequenceId!) || item.mediaId || item.sourceRange) issue(`序列素材“${item.name}”必须引用现有序列，不能引用文件或固定子剪辑范围。`)
    } else if (item.sequenceId) issue('只有序列素材可以引用序列。')
    if (item.binId && !binsById.has(item.binId)) issue('素材项的素材箱不存在。')
    const media = mediaById.get(item.mediaId!)
    if (item.sourceRange && (!media || !['video', 'audio'].includes(item.kind) || item.sourceRange.outUs > Math.round(media.durationSeconds * 1e6))) issue('子剪辑源范围超出原音视频素材。')
    if (!['text', 'code', 'graphic', 'adjustment', 'sequence'].includes(item.kind) && (!media || item.kind !== media.kind)) issue(`素材项 ${item.name} 的素材引用无效。`)
    if (['text', 'graphic', 'adjustment'].includes(item.kind) && item.mediaId) issue('文字、图形及调整图层不能引用媒体文件。')
    if (item.kind === 'graphic' ? !item.graphic : Boolean(item.graphic)) issue('只有图形素材项可以且必须保存结构化图形。')
    if (item.kind === 'code') {
      if (item.mediaId || !item.code) issue('代码素材项必须引用固定源码实例，不能引用预渲染媒体。')
      const definition = definitionsById.get(item.code?.definitionId ?? '')
      if (!definition?.versions.some(version => version.id === item.code?.versionId)) issue('代码素材项的固定源码版本不存在。')
    } else if (item.code) issue('普通素材项不能附带代码生成实例。')
    if (item.audioChannels) {
      if (!media || !(item.kind === 'audio' || item.kind === 'video' && media.hasAudio !== false)) issue('只有带声音的音视频素材项可以设置音频声道。')
      for (const mapping of item.audioChannels) { const problem = videoEditAudioMappingIssue(mapping, media?.audioStreams); if (problem) issue(problem) }
    }
  }
  for (const sequence of document.sequences) {
    if (sequence.multicam) {
      const cameras = sequence.multicam.cameras
      if (new Set(cameras.map(camera => camera.id)).size !== cameras.length || new Set(cameras.map(camera => camera.clipId)).size !== cameras.length) issue('多机位机位不能重复。')
      if (cameras.some(camera => !sequence.clips.some(clip => clip.id === camera.clipId && clip.kind === 'video'))) issue('多机位须引用源序列中的视频片段。')
      if (sequence.multicam.audioCameraId && !cameras.some(camera => camera.id === sequence.multicam!.audioCameraId)) issue('主音频机位不存在。')
    }
    if (sequence.binId && !binsById.has(sequence.binId)) issue('序列的素材箱不存在。')
    const clipsById = new Map(sequence.clips.map(clip => [clip.id, clip]))
    try { assertVideoEditContentAnchors(sequence) } catch (error) { issue(error instanceof Error ? error.message : '内容关联无效。') }
    const tracksByIndex = new Map(sequence.tracks.map(track => [track.index, track]))
    const fps = videoEditFps(sequence.frameRate)
    if (Math.round(sequence.width * sequence.pixelAspectRatio.numerator / sequence.pixelAspectRatio.denominator) > 8192) issue('等效画面宽度超出导出范围。')
    if (new Set(sequence.tracks.map(track => track.index)).size !== sequence.tracks.length) issue('序列轨道编号重复。')
    for (const clip of sequence.clips) {
      if (clip.elementOverrides && clip.kind !== 'code') issue('元素覆盖只能用于代码生成片段。')
      if (clip.textStyle && clip.kind !== 'text') issue('文字样式只能用于文字片段。')
      try {
        assertVideoEditKeyframeTimes(clip.curves, clip.duration, `片段“${clip.name}”`)
        for (const key of VIDEO_EDIT_ANIMATABLE_KEYS) for (const point of clip.curves?.[key] ?? []) for (const value of videoEditKeyframeValues(point)) videoEditClipAnimatedValueSchemas[key].parse(value)
        for (const effect of clip.effects ?? []) assertVideoEditKeyframeTimes(effect.builtin?.curves, clip.duration, `效果“${effect.name}”`)
        if (clip.kind === 'adjustment' && Object.keys(clip.curves ?? {}).some(key => key !== 'opacity')) issue('调整图层只允许不透明度关键帧。')
      } catch (error) { issue(error instanceof Error ? error.message : '片段关键帧无效。') }
      if (clip.trackers?.length && !['video', 'image', 'sequence'].includes(clip.kind)) issue('跟踪器只能放在视频、图片或嵌套序列片段上。')
      if (new Set(clip.trackers?.map(tracker => tracker.id)).size !== (clip.trackers?.length ?? 0)) issue(`片段“${clip.name}”的跟踪器 ID 重复。`)
      const item = itemsById.get(clip.itemId)
      const media = mediaById.get(item?.mediaId ?? '')
      const nested = item?.kind === 'sequence' ? sequencesById.get(item.sequenceId!) : undefined
      if (clip.multicamCameraId && !nested?.multicam?.cameras.some(camera => camera.id === clip.multicamCameraId)) issue('片段所选机位不属于多机位源序列。')
      if (nested && !videoEditClipWithinSource(clip, fps, VIDEO_EDIT_MAX_SEQUENCE_SECONDS, Math.max(1, videoEditClipSpeedValue(clip)) / fps)) issue(`片段 ${clip.name} 超出嵌套序列的 24 小时源时钟。`)
      const track = tracksByIndex.get(clip.track)
      const extractedAudio = item?.kind === 'video' && clip.kind === 'audio' && clip.sourceComponent === 'audio'
      if (clip.audioRole && clip.kind !== 'sequence' && (!media || media.hasAudio === false || !(clip.kind === 'audio' || clip.kind === 'video' && clip.sourceComponent !== 'video'))) issue('只有带声音的音视频片段可以标注声音类型。')
      if (!item || (item.kind !== clip.kind && !extractedAudio)) issue(`片段 ${clip.name} 的素材项引用无效。`)
      if (clip.sourceComponent && !(item?.kind === 'video' && ((clip.kind === 'video' && clip.sourceComponent === 'video') || extractedAudio))) issue('只有视频素材可以拆开引用画面或声音。')
      if (extractedAudio && media?.hasAudio !== true) issue('拆出的声音必须引用已确认具有音轨的视频素材。')
      if (clip.audioMapping) {
        if (!media || !(clip.kind === 'audio' || clip.kind === 'video' && clip.sourceComponent !== 'video')) issue('只有发声的音视频片段可以设置声道映射。')
        const problem = videoEditAudioMappingIssue(clip.audioMapping, media?.audioStreams); if (problem) issue(problem)
      }
      if (clip.kind === 'code') {
        if (!clip.code || clip.code.definitionId !== item?.code?.definitionId || !definitionsById.get(clip.code?.definitionId ?? '')?.versions.some(version => version.id === clip.code?.versionId)) issue('代码片段必须引用所属定义的固定源码版本。')
      } else if (clip.code) issue('普通片段不能附带代码生成实例。')
      if (clip.kind === 'graphic' ? !clip.graphic : Boolean(clip.graphic)) issue('只有图形片段可以且必须保存结构化图形。')
      if (clip.kind === 'adjustment' ? !clip.adjustment : Boolean(clip.adjustment)) issue('只有调整图层可以且必须保存作用范围。')
      for (const effect of clip.effects ?? []) {
        if (effect.builtin?.id === RECORDING_CURSOR_EFFECT && (clip.kind !== 'video' || !media?.recordingCursor)) issue('录制光标只能添加到绑定事件日志的屏幕视频片段，请从录制会话创建片段。')
        if (effect.builtin?.id === RECORDING_ZOOM_EFFECT && (clip.kind !== 'video' || !media?.recordingCursor)) issue('自动缩放只能添加到绑定事件日志的屏幕视频片段，请从录制会话创建片段。')
        if (effect.builtin?.id === 'color_grade') for (const key of ['input_lut', 'look_lut']) {
          const refs = [effect.builtin.params[key], ...(effect.builtin.curves?.[key] ?? []).map(point => point.value)]
            if (refs.some(ref => ref && !lutsById.has(String(ref)))) issue('全能调色 LUT引用不属于本项目，请选择已导入的LUT。')
        }
        const effectMedia = videoEditEffectMedia(effect)
        if (!videoEditEffectAccepts(effectMedia, clip)) { issue(effectMedia === 'audio' ? '音频效果只能加到声音片段。' : '画面效果不能附加到声音片段。'); break }
      }
      for (const code of videoEditEffectCodes(clip.effects)) if (!definitionsById.get(code.definitionId)?.versions.some(version => version.id === code.versionId)) issue('附加效果的固定源码版本不存在。')
      if (!track || track.kind !== (clip.kind === 'audio' ? 'audio' : 'video')) issue(`片段 ${clip.name} 的轨道类型不匹配。`)
      if (clip.start + clip.duration > Math.floor(fps * VIDEO_EDIT_MAX_SEQUENCE_SECONDS)) issue('序列最长为 24 小时。')
      if ((clip.speed || clip.reverse || clip.preservePitch || clip.timeRemap || clip.pitchSemitones || clip.frameInterpolation) && !videoEditClipSpeedSupported(clip.kind)) issue(`片段 ${clip.name} 不能改速度、倒放或变调。`)
      if (clip.frameHold && (clip.kind !== 'video' && clip.kind !== 'sequence' || clip.sourceComponent === 'audio' || clip.speed || clip.reverse || clip.preservePitch || clip.timeRemap)) issue('定格必须引用视频或序列画面，且不能同时变速、倒放、保持音调或使用速度曲线。')
      if (clip.timeRemap && clip.speed) issue(`片段 ${clip.name} 的速度曲线与常数速度不能同时存在。`)
      if (media && media.kind !== 'image' && !videoEditClipWithinSource(clip, fps, media.durationSeconds, Math.max(1, videoEditClipSpeedValue(clip)) / fps)) issue(`片段 ${clip.name} 超出源素材范围。`)
    }
    for (const annotation of sequence.annotations) {
      if (annotation.clipId && !clipsById.has(annotation.clipId)) issue('标注的片段不属于此序列。')
      if (annotation.target.kind === 'element' && clipsById.get(annotation.clipId!)?.kind !== 'code') issue('元素标注必须引用代码片段。')
      if (annotation.target.kind === 'range') {
        if (annotation.target.clipIds?.some(id => !clipsById.has(id))) issue('时间段标注的片段不属于此序列。')
        if (annotation.target.trackIds?.some(id => !sequence.tracks.some(track => track.id === id))) issue('时间段标注的轨道不属于此序列。')
      }
    }
    for (const marker of sequence.markers ?? []) {
      const clip = clipsById.get(marker.clipId ?? '')
      if (marker.frame >= Math.floor(fps * VIDEO_EDIT_MAX_SEQUENCE_SECONDS) || marker.clipId && (!clip || marker.frame < clip.start || marker.frame >= clip.start + clip.duration)) issue('标记须位于序列或所属片段的半开范围内。')
    }
    for (const caption of sequence.captions ?? []) {
      if (caption.speech?.words.some(word => !clipsById.has(word.clipId))) issue('字幕的声音来源须属于当前序列。')
      const clip = clipsById.get(caption.clipId ?? '')
      if (caption.start + caption.duration > Math.floor(fps * VIDEO_EDIT_MAX_SEQUENCE_SECONDS) || caption.clipId && (!clip || caption.start < clip.start || caption.start + caption.duration > clip.start + clip.duration)) issue('字幕须位于序列或所属片段的半开范围内。')
    }
    // Concurrent text surfaces consume compositor targets; total persisted captions remain unlimited.
    const edges = (sequence.captions ?? []).flatMap(caption => [{ at: caption.start, delta: 1 }, { at: caption.start + caption.duration, delta: -1 }]).sort((a, b) => a.at - b.at || a.delta - b.delta)
    let activeCaptions = 0
    for (const edge of edges) { activeCaptions += edge.delta; if (activeCaptions > 8) { issue('同一时刻最多显示8段字幕。'); break } }
    try { validateVideoEditAdjustmentRanges(sequence) } catch (error) { issue(error instanceof Error ? error.message : '调整图层范围无效。') }
  }
  try { validateVideoEditTransitions(document) } catch (error) { issue(error instanceof Error ? error.message : '转场范围无效。') }
  try { assertVideoEditSequenceGraph(document) } catch (error) { issue(error instanceof Error ? error.message : '序列嵌套无效。') }
})
export type VideoEditDocument = z.infer<typeof videoEditDocumentSchema>
export type VideoEditSequence = z.infer<typeof videoEditSequenceSchema>
export type VideoEditClip = z.infer<typeof videoEditClipSchema>
export type VideoEditClipTake = z.infer<typeof videoEditClipTakeSchema>
export type VideoEditMedia = z.infer<typeof videoEditMediaSchema>
export type VideoEditItem = z.infer<typeof videoEditItemSchema>
export type VideoEditBin = z.infer<typeof videoEditBinSchema>
export type VideoEditAnnotation = z.infer<typeof videoEditAnnotationSchema>
export type VideoEditComposition = VideoEditSequence & Pick<VideoEditDocument, 'media' | 'items' | 'revision' | 'codeMaterials' | 'colorLuts' | 'styles'> & { fps: number; sequences?: VideoEditSequence[] }
export function createVideoEditSequence(name = '序列 1'): VideoEditSequence {
  return { id: crypto.randomUUID(), name, width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
    // 新序列与 PR 一样只有一条视频轨（V1）和一条音频轨（A1）；需要更多轨道时拖到轨道外或用轨道头菜单添加。
    tracks: Array.from({ length: 2 }, (_, index) => ({ id: crypto.randomUUID(), name: index === 0 ? '音频 1' : '视频 1', index, kind: index === 0 ? 'audio' : 'video', locked: false, enabled: true, muted: false, solo: false })), clips: [], annotations: [] }
}
export function createVideoEditDocument(name: string): VideoEditDocument {
  return { format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: crypto.randomUUID(), name, revision: 0, media: [], bins: [], items: [], sequences: [] }
}
export function videoEditComposition(document: VideoEditDocument, sequenceId: string): VideoEditComposition {
  const sequence = document.sequences.find(item => item.id === sequenceId)
  if (!sequence) throw new Error('目标序列不存在。')
  return composeVideoEditSequence(document, sequence)
}
function composeVideoEditSequence(document: Pick<VideoEditComposition, 'media' | 'items' | 'sequences' | 'styles' | 'colorLuts' | 'codeMaterials' | 'revision'>, sequence: VideoEditSequence): VideoEditComposition {
  return { ...sequence, width: Math.round(sequence.width * sequence.pixelAspectRatio.numerator / sequence.pixelAspectRatio.denominator), media: document.media, items: document.items, sequences: document.sequences, ...(document.styles ? { styles: document.styles } : {}), ...(document.colorLuts ? { colorLuts: document.colorLuts } : {}), ...(document.codeMaterials ? { codeMaterials: document.codeMaterials } : {}), revision: document.revision, fps: videoEditFps(sequence.frameRate) }
}
export function videoEditClipMedia(document: Pick<VideoEditComposition, 'media' | 'items'>, clip: VideoEditClip): VideoEditMedia | undefined {
  const item = document.items.find(item => item.id === clip.itemId)
  return document.media.find(media => media.id === item?.mediaId)
}
/** Render/export snapshots carry the complete sequence graph; files stay in media only. */
export function videoEditNestedComposition(document: VideoEditComposition, clip: Pick<VideoEditClip, 'itemId' | 'kind' | 'multicamCameraId'> & Partial<VideoEditClip>): VideoEditComposition | undefined {
  if (clip.kind !== 'sequence') return undefined
  const item = document.items.find(item => item.id === clip.itemId)
  const sequence = document.sequences?.find(sequence => sequence.id === item?.sequenceId)
  if (!sequence) throw new Error('嵌套序列已移除或未包含在渲染快照中。')
  const composition = composeVideoEditSequence(document, sequence)
  if (clip.start !== undefined && clip.duration !== undefined && clip.sourceInUs !== undefined) {
    const timing = { start: clip.start, duration: clip.duration, sourceInUs: clip.sourceInUs, sourceRemainder: clip.sourceRemainder ?? { numerator: 0, denominator: 1 }, speed: clip.speed, reverse: clip.reverse, frameHold: clip.frameHold, timeRemap: clip.timeRemap }
    composition.captions = projectVideoEditNestedCaptions(sequence, timing, document.fps)
    composition.clips = projectVideoEditNestedContentClips(sequence, timing, document.fps)
  }
  if (!sequence.multicam) return composition
  const camera = sequence.multicam.cameras.find(camera => camera.id === (clip.multicamCameraId ?? sequence.multicam!.cameras[0].id))
  if (!camera) throw new Error('片段所选机位已移除。')
  const audio = sequence.multicam.cameras.find(camera => camera.id === sequence.multicam!.audioCameraId)
  // Keep source timing intact; picture switches never restart or change the selected master sound.
  const picture = sequence.clips.find(value => value.id === camera.clipId)!
  const master = audio && sequence.clips.find(value => value.id === audio.clipId)
  const audioIndex = sequence.tracks.reduce((maximum, track) => Math.max(maximum, track.index), -1) + 1
  const tracks = sequence.tracks.filter(track => track.index === picture.track).map(track => ({ ...track, muted: true, solo: false }))
  const clips: VideoEditClip[] = [{ ...picture, sourceComponent: 'video' }]
  if (master && videoEditClipMedia(document, master)?.hasAudio !== false) {
    const sourceTrack = sequence.tracks.find(track => track.index === master.track)!
    clips.push({ ...master, id: `${master.id}:master`, kind: 'audio', sourceComponent: 'audio', track: audioIndex })
    tracks.push({ ...sourceTrack, id: `${sequence.id}:master`, name: '主音频', index: audioIndex, kind: 'audio', solo: false })
  }
  return { ...composition, clips, tracks, transitions: [] }

}
export function videoEditClipSourceDuration(document: VideoEditComposition, clip: VideoEditClip): number | undefined {
  const nested = videoEditNestedComposition(document, clip)
  if (nested) return videoEditDuration(nested) / nested.fps
  const media = videoEditClipMedia(document, clip)
  return media?.kind === 'image' ? undefined : media?.durationSeconds
}
export function videoEditDuration(document: Pick<VideoEditSequence, 'clips' | 'captions' | 'markers'>): number {
  let end = 1
  for (const clip of document.clips) end = Math.max(end, clip.start + clip.duration)
  for (const caption of document.captions ?? []) end = Math.max(end, caption.start + caption.duration)
  for (const marker of document.markers ?? []) end = Math.max(end, marker.frame + 1)
  return end
}
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
  let candidates = document.clips.filter(clip => !clip.frameHold && ['video', 'audio', 'sequence'].includes(clip.kind) && clip.sourceComponent !== 'video' && (clip.disabledIntrinsicSections?.includes('audio') || clip.volume > 0 || clip.curves?.volume?.some(point => typeof point.value === 'number' && point.value > 0)))
  // Source-sequence audition/export uses the same chosen master as placed multicamera segments.
  if (document.multicam && candidates.some(clip => document.multicam!.cameras.some(camera => camera.clipId === clip.id))) {
    const master = document.multicam.cameras.find(camera => camera.id === document.multicam!.audioCameraId)
    candidates = candidates.filter(clip => clip.id === master?.clipId || !document.multicam!.cameras.some(camera => camera.clipId === clip.id))
  }
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
    return { ...clip, start: Math.min(Math.floor(document.fps * VIDEO_EDIT_MAX_SEQUENCE_SECONDS) - clip.duration, start), track: adjustment.track }
  }
  const sourceDuration = videoEditClipSourceDuration(document, clip)
  const program = clip.code ? codeMetadata?.(clip.code) : undefined
  if (clip.kind === 'code' && !program) throw new Error('代码片段尚未完成源码检查。')
  const timed = ['video', 'audio', 'code', 'graphic', 'adjustment', 'sequence'].includes(clip.kind) || Boolean(clip.effects?.length)
  if (adjustment.mode === 'out') {
    const limit = Math.min(Math.floor(document.fps * VIDEO_EDIT_MAX_SEQUENCE_SECONDS) - clip.start, program?.mode === 'dynamic' && program.durationSeconds !== undefined ? clip.duration + videoEditClipTailRoom(clip, document.fps, program.durationSeconds) + 1 : timed && sourceDuration !== undefined ? clip.duration + videoEditClipTailRoom(clip, document.fps, sourceDuration) : Infinity)
    const duration = Math.max(1, Math.min(limit, clip.duration + adjustment.delta))
    return { ...sliceVideoEditClipKeyframes(clip, 0, duration), duration }
  }
  const shift = Math.max(-clip.start, timed ? -videoEditClipHeadRoom(clip, document.fps, program?.mode === 'dynamic' ? program.durationSeconds : sourceDuration) : -clip.start, Math.min(clip.duration - 1, adjustment.delta))
  return { ...sliceVideoEditClipKeyframes(clip, shift, clip.duration - shift), start: clip.start + shift, duration: clip.duration - shift, ...(timed ? advanceVideoEditClipSource(clip, shift, document.frameRate) : {}) }
}
export function splitVideoEditClip(sequence: VideoEditSequence, id: string, at: number): VideoEditSequence {
  const clip = sequence.clips.find(item => item.id === id)
  if (!clip || !Number.isInteger(at) || at <= clip.start || at >= clip.start + clip.duration) throw new Error('请将播放头置于片段内部再拆分。')
  const left = at - clip.start
  const sliced = sliceVideoEditClipKeyframes(clip, left, clip.duration - left)
  const right = { ...sliced, ...(clip.code ? { code: structuredClone(clip.code) } : {}), ...(clip.graphic ? { graphic: structuredClone(clip.graphic) } : {}), ...(sliced.effects ? { effects: sliced.effects.map(effect => ({ ...structuredClone(effect), id: crypto.randomUUID() })) } : {}), id: crypto.randomUUID(), start: at, duration: clip.duration - left, ...splitVideoEditClipSource(clip, left, sequence.frameRate) }
  // 淡入留在左半段开头、淡出留在右半段结尾（PR 拆分后淡化手柄跟着原片段的首尾）。
  delete right.fadeInFrames
  const leftPart = { ...sliceVideoEditClipKeyframes(clip, 0, left), duration: left }; delete leftPart.fadeOutFrames
  if (clip.contentAnchor) {
    leftPart.contentAnchor = sliceVideoEditContentAnchor(clip.contentAnchor, sequence, clip.start, at)
    right.contentAnchor = sliceVideoEditContentAnchor(clip.contentAnchor, sequence, at, clip.start + clip.duration)
  }
  const next = { ...sequence, clips: sequence.clips.flatMap(item => item.id === id ? [leftPart, right] : [item]), annotations: sequence.annotations.flatMap(item => {
    const spansSplit = item.frame < at && (item.endFrame ?? item.frame) >= at
    if (item.clipId === id && spansSplit && item.target.kind === 'element') return [{ ...item, endFrame: at - 1 }, { ...item, id: crypto.randomUUID(), clipId: right.id, frame: at, status: item.status === 'draft' ? 'draft' as const : 'open' as const, addressedBy: undefined }]
    const target = item.target.kind === 'range' && (item.target.clipIds?.includes(id) || item.clipId === id && spansSplit) ? { ...item.target, clipIds: [...new Set((item.target.clipIds ?? [id]).flatMap(value => value !== id ? [value] : item.frame >= at ? [right.id] : spansSplit ? [id, right.id] : [id]))] } : item.target
    return [{ ...item, target, ...(item.clipId === id ? item.frame >= at ? { clipId: right.id } : spansSplit && item.target.kind !== 'element' ? { clipId: undefined } : {} : {}) }]
  }) }
  const origins = new Map([[right.id, { originalId: id, shift: 0 }], [id, { originalId: id, shift: 0 }]])
  return retimeVideoEditContent(sequence, next, origins)
}
export function changeVideoEditSequenceSettings(sequence: VideoEditSequence, settings: Partial<Pick<VideoEditSequence, 'width' | 'height' | 'frameRate' | 'pixelAspectRatio' | 'sampleRate' | 'channels'>>): VideoEditSequence {
  const rate = settings.frameRate ?? sequence.frameRate
  const convert = (frame: number): number => rescaleVideoEditFrame(frame, sequence.frameRate, rate)
  if (sequence.clips.some(clip => convert(clip.start + clip.duration) <= convert(clip.start))) throw new Error('新帧率会使部分片段短于一帧。请先调整这些片段的长度，再修改帧率。')
  if (sequence.captions?.some(caption => convert(caption.start + caption.duration) <= convert(caption.start))) throw new Error('新帧率会使部分字幕短于一帧。请先调整这些字幕的长度，再修改帧率。')
  if (sequence.transitions?.some(transition => convert(transition.durationFrames) < 2)) throw new Error('新帧率会使部分转场短于两帧。请先调整这些转场的长度，再修改帧率。')
  return videoEditSequenceSchema.parse({ ...sequence, ...settings,
    clips: sequence.clips.map(clip => ({ ...rescaleVideoEditClipKeyframes(clip, time => convert(clip.start + time) - convert(clip.start), convert(clip.start + clip.duration) - convert(clip.start)), start: convert(clip.start), duration: convert(clip.start + clip.duration) - convert(clip.start), ...(clip.fadeInFrames ? { fadeInFrames: Math.max(1, convert(clip.fadeInFrames)) } : {}), ...(clip.fadeOutFrames ? { fadeOutFrames: Math.max(1, convert(clip.fadeOutFrames)) } : {}) })),
    annotations: sequence.annotations.map(mark => mapVideoEditAnnotationTime(mark, convert)),
    ...(sequence.markers ? { markers: sequence.markers.map(mark => ({ ...mark, frame: convert(mark.frame) })) } : {}),
    ...(sequence.captions ? { captions: sequence.captions.map(caption => ({ ...caption, start: convert(caption.start), duration: convert(caption.start + caption.duration) - convert(caption.start) })) } : {}),
    ...(sequence.transitions ? { transitions: sequence.transitions.map(transition => ({ ...resizeVideoEditTransition(transition, convert(transition.durationFrames), convert), ...(transition.framesBeforeCut !== undefined ? { framesBeforeCut: Math.min(convert(transition.durationFrames), convert(transition.framesBeforeCut)) } : {}) })) } : {}),
  })
}
