import { videoEditClipRemixSchema } from '@/core/videoEdit/musicRemix'
import { codeFilePathSchema, codeSourceTextSchema } from '@/core/videoEdit/codeMaterial/sources'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '@/core/videoEdit/time'
import { videoEditSelectedCodeElementContextSchema } from '@/core/videoEdit/codeElementSelection'
import { videoEditTrackerSchema, videoEditTrackRecordingSchema } from '@/core/videoEdit/tracking'
import { videoEditLabelSchema } from '@/core/videoEdit/labels'
import { recordingZoomRegionsSchema } from '@/core/videoEdit/recordingZoom'
import { VIDEO_EDIT_TEXT_STYLE_DESCRIPTION, videoEditTextStyleSchema } from '@/core/videoEdit/text'
import { z } from 'zod'
import { mediaContentQueryProgressSchema } from '@/core/media/contentIndex'
import { videoEditContentAnchorInputSchema } from '@/core/videoEdit/contentAnchors'
import { type ApplicationFieldDefinition, type JsonValue, type ApplicationSchemaRef } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { videoEditAnnotationSchema, videoEditClipSchema, videoEditSequenceSchema, videoEditBinSchema, videoEditItemSchema, videoEditTrackSchema, videoEditMediaSchema } from '@/core/videoEdit/document'
import { videoEditAnnotationMessageSchema } from '@/core/videoEdit/annotations'
import { codeMaterialInstanceSchema, codeMaterialVersionSchema } from '@/core/videoEdit/codeMaterialPersistence'
import { codeMaterialCurvesSchema } from '@/core/videoEdit/codeMaterialAnimation'
import { videoEditTimelineViewSchema, videoEditProgramPlaybackSchema } from '@/core/videoEdit/timelineSelection'
import { videoEditPlaybackResolutionSchema } from '@/core/videoEdit/playbackResolution'
import { videoEditMarkerSchema, videoEditCaptionSchema } from '@/core/videoEdit/timedContent'
import { videoEditEffectSchema, videoEditBuiltinEffectInstanceSchema, videoEditEffectMaskSchema, videoEditAdjustmentSchema } from '@/core/videoEdit/compositing'
import { videoEditTransitionSchema } from '@/core/videoEdit/transitions'
import { VIDEO_EDIT_COMPOSITE_TYPES } from './videoEditCompositeEntities'
import { videoEditAudioLayoutSchema, videoEditAudioMappingSchema, videoEditAudioStreamsSchema } from '@/core/videoEdit/audioChannels'
import { VIDEO_EDIT_ANIMATABLE_KEYS, videoEditKeyframesSchema } from '@/core/videoEdit/keyframes'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS } from '@/core/videoEdit/builtinEffects'
import { videoEditFrameInterpolationSchema, videoEditTimeRemapSchema } from '@/core/videoEdit/timeRemap'

export const VIDEO_EDIT_TYPES = ['video_edit.document', 'video_edit.clip', 'video_edit.annotation', 'video_edit.media', 'video_edit.sequence', 'video_edit.bin', 'video_edit.item', 'video_edit.track', 'video_edit.source', 'video_edit.code_material', 'video_edit.code_version', 'video_edit.marker', 'video_edit.caption', ...VIDEO_EDIT_COMPOSITE_TYPES, 'video_edit.builtin_effect'] as const
export type VideoEditEntityType = typeof VIDEO_EDIT_TYPES[number]
export type VideoEditFieldData = Record<string, JsonValue>
export function videoEditPropertyKey(key: string): string { return key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`) }
export function videoEditDataKey(key: string): string { return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) }
const text = z.string().max(2000)
export const VIDEO_EDIT_TIME_CASCADES = [
  { declarationId: 'video_edit.sequence_clip_time', effect: 'update', entityType: 'video_edit.clip', propertyIds: ['video_edit.clip.start', 'video_edit.clip.duration', ...VIDEO_EDIT_ANIMATABLE_KEYS.map(key => `video_edit.clip.${videoEditPropertyKey(key)}.keyframes`)], revisionScopes: ['video_edit'] },
  { declarationId: 'video_edit.sequence_annotation_time', effect: 'update', entityType: 'video_edit.annotation', propertyIds: ['video_edit.annotation.frame', 'video_edit.annotation.end_frame', 'video_edit.annotation.target'], revisionScopes: ['video_edit'] },
  { declarationId: 'video_edit.sequence_marker_time', effect: 'update', entityType: 'video_edit.marker', propertyIds: ['video_edit.marker.frame'], revisionScopes: ['video_edit'] },
  { declarationId: 'video_edit.sequence_caption_time', effect: 'update', entityType: 'video_edit.caption', propertyIds: ['video_edit.caption.start', 'video_edit.caption.duration'], revisionScopes: ['video_edit'] },
] as const
export const VIDEO_EDIT_CLIP_KEYFRAME_TIME_CASCADE = { declarationId: 'video_edit.clip_keyframe_time', effect: 'update' as const, entityType: 'video_edit.clip', propertyIds: VIDEO_EDIT_ANIMATABLE_KEYS.map(key => `video_edit.clip.${videoEditPropertyKey(key)}.keyframes`), revisionScopes: ['video_edit'] }
export const VIDEO_EDIT_CLIP_CONTENT_CASCADES = (['create', 'update', 'delete'] as const).flatMap(effect => (['marker', 'caption', 'clip'] as const).map(kind => ({ declarationId: `video_edit.clip_${kind}_${effect}`, effect, entityType: `video_edit.${kind}`, propertyIds: effect === 'update' ? kind === 'clip' ? ['video_edit.clip.start', 'video_edit.clip.duration', 'video_edit.clip.content_anchor', ...VIDEO_EDIT_ANIMATABLE_KEYS.map(key => `video_edit.clip.${videoEditPropertyKey(key)}.keyframes`)] : kind === 'marker' ? ['video_edit.marker.frame', 'video_edit.marker.clip_id'] : ['video_edit.caption.start', 'video_edit.caption.duration', 'video_edit.caption.clip_id', 'video_edit.caption.text', 'video_edit.caption.source_text', 'video_edit.caption.speech', 'video_edit.caption.review_reasons'] : [], revisionScopes: ['video_edit'] })))
const compositeUpdateKeys = { 'video_edit.tracker': ['name', 'method', 'prompts'], 'video_edit.graphic_object': ['name', 'parameters', 'curves', 'text_style', 'visible'], 'video_edit.effect': ['name', 'enabled', 'amount', 'version_id', 'parameters', 'curves', 'frame_curves', 'mask', 'regions'], 'video_edit.transition': ['kind', 'duration_frames', 'alignment', 'frames_before_cut', 'parameters', 'frame_curves'] }
export const VIDEO_EDIT_COMPOSITE_CASCADES = (['create', 'update', 'delete'] as const).flatMap(effect => VIDEO_EDIT_COMPOSITE_TYPES.map(entityType => ({ declarationId: `${entityType}_${effect}`, effect, entityType, propertyIds: effect === 'update' ? compositeUpdateKeys[entityType].map(key => `${entityType}.${key}`) : [], revisionScopes: ['video_edit'] })))
export const VIDEO_EDIT_SOURCE_PROGRAM_CASCADE = { declarationId: 'video_edit.source_foreground_program_pause', effect: 'update' as const, entityType: 'video_edit.document', propertyIds: ['video_edit.document.program_playback'], revisionScopes: ['video_edit'] }
export const VIDEO_EDIT_PROGRAM_SOURCE_CASCADE = { declarationId: 'video_edit.program_foreground_source_pause', effect: 'update' as const, entityType: 'video_edit.source', propertyIds: ['video_edit.source.playing'], revisionScopes: ['video_edit'] }
const schemas: Record<VideoEditEntityType, Record<string, z.ZodType>> = {
  'video_edit.document': { name: z.string().min(1).max(200), frame: z.number().int().nonnegative(), selection: z.string(), activeSequenceId: z.string(), dirty: z.boolean(), selectedItemIds: z.array(z.string().min(1)), selectedBinId: z.string().max(100), openSequenceIds: z.array(z.string().min(1)) },
  // 速度（4.13）以 speed_percent 百分比公开（见下），不公开内部有理数。
  'video_edit.clip': Object.fromEntries(Object.entries(videoEditClipSchema.shape).filter(([key]) => !['id', 'sourceRemainder', 'speed', 'curves'].includes(key))),
  'video_edit.annotation': Object.fromEntries(Object.entries(videoEditAnnotationSchema.shape).filter(([key]) => key !== 'id' && key !== 'sourceRemainder')),
  'video_edit.sequence': Object.fromEntries(Object.entries(videoEditSequenceSchema.shape).filter(([key]) => !['id', 'clips', 'annotations', 'tracks', 'markers', 'captions', 'textTranscription'].includes(key))),
  'video_edit.marker': { ...Object.fromEntries(Object.entries(videoEditMarkerSchema.shape).filter(([key]) => key !== 'id')), clipId: z.string().max(100) },
  'video_edit.caption': { ...Object.fromEntries(Object.entries(videoEditCaptionSchema.shape).filter(([key]) => key !== 'id')), clipId: z.string().max(100) },
  'video_edit.bin': Object.fromEntries(Object.entries(videoEditBinSchema.shape).filter(([key]) => !['id', 'sourceFolderPath'].includes(key))),
  'video_edit.item': Object.fromEntries(Object.entries(videoEditItemSchema.shape).filter(([key]) => key !== 'id')),
  // index/kind are read-only: clips are placed by the integer track index, so agents must be able to read it.
  'video_edit.track': Object.fromEntries(Object.entries(videoEditTrackSchema.shape).filter(([key]) => key !== 'id')),
  'video_edit.media': { name: text, kind: z.enum(['video', 'image', 'audio']), durationSeconds: z.number(), width: z.number(), height: z.number() },
  'video_edit.source': { itemId: z.string().max(100), timeUs: z.number().int().nonnegative(), presentedTimeUs: z.number().int().nonnegative(), playing: z.boolean(), volume: z.number().min(0).max(1), inUs: z.number().int().nonnegative().nullable(), outUs: z.number().int().nonnegative().nullable(), playbackDirection: z.union([z.literal(1), z.literal(-1)]), status: z.enum(['closed', 'loading', 'ready', 'error']), error: text },
  'video_edit.code_material': { name: z.string().min(1).max(200), source: codeSourceTextSchema, files: z.record(codeFilePathSchema, codeSourceTextSchema), entry: codeFilePathSchema, defaultVersionId: z.string().min(1).max(100), versionIds: z.array(z.string()), binId: z.string().max(100), parameters: z.array(z.record(z.string(), z.json())), types: z.record(z.string(), z.json()) },
  'video_edit.code_version': { source: codeSourceTextSchema, files: z.record(codeFilePathSchema, codeSourceTextSchema), entry: codeFilePathSchema, apiVersion: codeMaterialVersionSchema.shape.apiVersion, languageVersion: codeMaterialVersionSchema.shape.languageVersion, definitionId: z.string().min(1).max(100), parameters: z.array(z.record(z.string(), z.json())), types: z.record(z.string(), z.json()) },
  'video_edit.tracker': { name: videoEditTrackerSchema.shape.name, method: videoEditTrackerSchema.shape.method, prompts: videoEditTrackerSchema.shape.prompts, status: text, clipId: z.string().min(1).max(100), sequenceId: z.string().min(1).max(100) },
  'video_edit.graphic_object': { name: z.string().trim().min(1).max(200), kind: z.enum(['rect', 'ellipse', 'text']), clipId: z.string().min(1).max(100), sequenceId: z.string().min(1).max(100), parameters: codeMaterialInstanceSchema.shape.parameters, curves: codeMaterialCurvesSchema, textStyle: videoEditTextStyleSchema.nullable(), visible: z.boolean() },
  'video_edit.effect': { name: videoEditEffectSchema.shape.name, enabled: videoEditEffectSchema.shape.enabled, amount: videoEditEffectSchema.shape.amount, definitionId: codeMaterialInstanceSchema.shape.definitionId, versionId: codeMaterialInstanceSchema.shape.versionId, parameters: codeMaterialInstanceSchema.shape.parameters, curves: codeMaterialCurvesSchema, clipId: z.string().min(1).max(100), sequenceId: z.string().min(1).max(100), mask: videoEditEffectMaskSchema.nullable(), regionStatus: text },
  'video_edit.transition': { ...Object.fromEntries(Object.entries(videoEditTransitionSchema.shape).filter(([key]) => key !== 'id')), sequenceId: z.string().min(1).max(100) },
  // 内置效果目录（4.7a，只读）：助手据此选效果、按参数语义取值，再用 video_edit.effect 加到片段上。
  'video_edit.builtin_effect': { name: text, group: text, description: text, params: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))).max(Math.max(16, ...VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.map(definition => definition.params.length))) },
}
schemas['video_edit.document'].audioLinkNotices = z.array(z.object({ clipId: z.string(), message: z.string() }).strict()).describe('链接音频刷新后的截短或移除提示，只读，不移动后续片段。')
schemas['video_edit.document'].audioAnalysisProgress = z.number().min(0).max(1).nullable().describe('原素材音频分析进度，0–1；没有任务时为 null。取消通过当前算法操作的取消信号。')
schemas['video_edit.media'].audioAnalysis = z.object({ bpm: z.number(), beats: z.array(z.number()), onsets: z.array(z.number()), beatsPerBar: z.number(), barOrigin: z.number() }).strict().nullable().describe('原素材音频分析；未分析或内容改变为 null。调用 analyze_video_edit_beats 并指定 mediaRef。时刻为源素材秒数，四拍分组与 barOrigin 为估计；不能据未分析数据声称对拍。')
schemas['video_edit.media'].recordingCursorMode = z.enum(['unavailable', 'redraw', 'clicks'])
schemas['video_edit.media'].musicStructure = z.object({ tempo: z.number(), beatsPerBar: z.number().int(), beats: z.number().int(), beatSource: z.enum(['beat_this', 'spectral_flux']), suitable: z.boolean(), unsuitableReason: z.string().nullable(), sections: z.array(z.object({ startSeconds: z.number(), label: z.string() }).strict()) }).strict().nullable().describe('最近一次音频重构所用的音乐结构摘要（BPM、每小节拍数、拍数、段落起点与相似标签 A/B…、是否适合重构及原因）；只在内存里，未分析或素材变化为 null。调用 remix_video_edit_music 时自动分析。')
schemas['video_edit.clip'].remix = videoEditClipRemixSchema.nullable()
schemas['video_edit.clip'].multicamCameraId = z.string().max(100)
schemas['video_edit.sequence'].styleId = z.string().max(64)
schemas['video_edit.sequence'].captionTrackEnabled = videoEditSequenceSchema.shape.captionTrackEnabled.unwrap()
schemas['video_edit.sequence'].motionBlur = videoEditSequenceSchema.shape.motionBlur.unwrap()
// 片段只存“关掉”：true 表示跟随序列总开关（存储时省略），false 只关这个片段
schemas['video_edit.clip'].motionBlur = z.boolean()
schemas['video_edit.sequence'].frameBlend = videoEditSequenceSchema.shape.frameBlend.unwrap()
schemas['video_edit.sequence'].captionTrackLocked = videoEditSequenceSchema.shape.captionTrackLocked.unwrap()
schemas['video_edit.sequence'].multicam = videoEditSequenceSchema.shape.multicam.unwrap().nullable()
schemas['video_edit.clip'].effectsEnabled = videoEditClipSchema.shape.effectsEnabled.unwrap()
schemas['video_edit.clip'].disabledIntrinsicSections = videoEditClipSchema.shape.disabledIntrinsicSections.unwrap()
schemas['video_edit.clip'].codeParameters = codeMaterialInstanceSchema.shape.parameters
schemas['video_edit.item'].codeParameters = codeMaterialInstanceSchema.shape.parameters
schemas['video_edit.item'].codeCurves = codeMaterialCurvesSchema
schemas['video_edit.sequence'].transcript = z.array(z.object({ index: z.number().int().nonnegative(), text: z.string(), from: z.number().int().nonnegative(), to: z.number().int().positive(), editable: z.boolean(), granularity: z.enum(['word', 'segment']) }).strict()).max(100000)
schemas['video_edit.sequence'].textSilences = z.array(z.object({ from: z.number().int().nonnegative(), to: z.number().int().positive() }).strict()).max(100000)
for (const key of VIDEO_EDIT_ANIMATABLE_KEYS) schemas['video_edit.clip'][`${key}.keyframes`] = videoEditKeyframesSchema
// 内置效果的参数关键帧合在一个属性里（参数多达数百个，逐参数登记会让每次修改的回执列出全部属性）。
// 自动缩放的缩放区间（源时间微秒，整体替换）；其他效果读出空数组且只能写空数组。
schemas['video_edit.effect'].regions = recordingZoomRegionsSchema
schemas['video_edit.effect'].frameCurves = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), videoEditKeyframesSchema.refine(points => points.length > 0, '要关闭某个参数的动画，整体写入时省略它，不写空数组。'))
schemas['video_edit.transition'].frameCurves = schemas['video_edit.effect'].frameCurves
for (const key of ['anchorX', 'anchorY'] as const) schemas['video_edit.clip'][key] = videoEditClipSchema.shape[key].unwrap()
schemas['video_edit.clip'].textStyle = videoEditTextStyleSchema.nullable()
schemas['video_edit.clip'].graphic = videoEditClipSchema.shape.graphic.nullable()
schemas['video_edit.clip'].adjustment = videoEditClipSchema.shape.adjustment.nullable()
schemas['video_edit.item'].graphic = videoEditItemSchema.shape.graphic.nullable()
schemas['video_edit.item'].sourceRange = videoEditItemSchema.shape.sourceRange.unwrap().nullable()
schemas['video_edit.item'].sequenceId = z.string().max(100)
// 颜色标签：读出 null 表示按类型默认，写 null 恢复默认（3.2）。
for (const type of ['video_edit.item', 'video_edit.bin', 'video_edit.sequence'] as const) schemas[type].label = videoEditLabelSchema.nullable()
schemas['video_edit.clip'].graphicObjectIds = z.array(z.string().min(1).max(100))
schemas['video_edit.clip'].effectIds = z.array(z.string().min(1).max(100))
schemas['video_edit.clip'].adjustmentFromTrack = videoEditAdjustmentSchema.shape.fromTrack.nullable()
schemas['video_edit.item'].graphicKind = z.enum(['solid', 'rect', 'ellipse', 'text']).nullable()
schemas['video_edit.item'].graphicWidth = z.number().int().min(16).max(8192).nullable()
schemas['video_edit.item'].graphicHeight = z.number().int().min(16).max(8192).nullable()
schemas['video_edit.effect'].parameters = codeMaterialInstanceSchema.shape.parameters.or(videoEditBuiltinEffectInstanceSchema.shape.params.refine(value => Object.keys(value).length <= 128, '内置效果参数最多128个。'))
schemas['video_edit.document'].colorLuts = z.array(z.object({ id: z.string(), name: z.string() }).strict())
schemas['video_edit.document'].timelineView = videoEditTimelineViewSchema
schemas['video_edit.document'].mediaImport = z.object({ phase: z.enum(['enumerating', 'probing']), completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), totalKnown: z.boolean(), discovered: z.number().int().nonnegative(), queued: z.number().int().nonnegative(), requests: z.number().int().nonnegative(), imported: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() }).strict().nullable()
schemas['video_edit.document'].programPlayback = videoEditProgramPlaybackSchema
// 回放分辨率（4.9）：节目监视器的视图偏好，按剪辑记在本机，不进剪辑文件与撤销栈。
schemas['video_edit.document'].proxyPreference = z.object({ enabled: z.boolean(), autoCreate: z.boolean() }).strict()
schemas['video_edit.media'].proxyState = z.object({ status: z.enum(['none', 'generating', 'ready']), progress: z.number().min(0).max(1), error: z.string() }).strict()
schemas['video_edit.document'].playbackResolution = videoEditPlaybackResolutionSchema
schemas['video_edit.document'].renderPreference = z.object({ autoRender: z.boolean() }).strict()
schemas['video_edit.document'].renderCache = z.object({ windows: z.array(z.object({ startFrame: z.number().int(), endFrame: z.number().int(), state: z.enum(['ready', 'rendering', 'dropped', 'predicted', 'realtime']), performance: z.object({ sampleFrames: z.number().int(), droppedFrames: z.number().int(), p90Ms: z.number() }).strict().optional() }).strict()), readyFrames: z.number().int(), needsRenderFrames: z.number().int(), totalFrames: z.number().int(), rendering: z.object({ done: z.number().int(), total: z.number().int() }).strict().nullable() }).strict()
schemas['video_edit.clip'].codeCurves = codeMaterialCurvesSchema
schemas['video_edit.clip'].codeVersionId = z.string().min(1).max(100)
schemas['video_edit.clip'].linkId = z.string().max(100)
schemas['video_edit.clip'].groupId = z.string().max(100)
schemas['video_edit.clip'].sourceComponent = z.enum(['all', 'video', 'audio'])
schemas['video_edit.media'].assetId = z.string().max(100).optional()
schemas['video_edit.media'].codeImageGeneration = videoEditMediaSchema.shape.codeImageGeneration.unwrap().nullable()
schemas['video_edit.media'].hasAudio = z.boolean().nullable()
schemas['video_edit.clip'].creativeSource = videoEditClipSchema.shape.creativeSource.unwrap().nullable()
// 可切回的镜头版本（4.12）：由“替换镜头”记下、restore_video_edit_clip_take 切换，只读
schemas['video_edit.clip'].trackers = videoEditClipSchema.shape.trackers.unwrap().nullable()
schemas['video_edit.clip'].follow = videoEditClipSchema.shape.follow.unwrap().nullable()
schemas['video_edit.clip'].stabilization = videoEditClipSchema.shape.stabilization.unwrap().nullable()
schemas['video_edit.tracker'].recording = videoEditTrackRecordingSchema.nullable()
schemas['video_edit.clip'].contentAnchor = videoEditContentAnchorInputSchema.describe('关联这段画面与口述内容：{matchId,startOffsetSeconds?,endOffsetSeconds?} 直接使用 query_video_edit_transcript 的原始词级候选。两个偏移为相对内容开头/结尾的秒数，负数提前，正数延后。读回的 ranges 是保留的来源区间，可原样回写；null 解除关联并保留当前时间。内容移动、剪掉或变速时关联画面跟随；拖动画面会保留人工偏移；来源素材替换时解除旧关联。不允许自关联或循环。')
schemas['video_edit.clip'].takes = videoEditClipSchema.shape.takes.unwrap().nullable()
schemas['video_edit.media'].frameRate = z.object({ numerator: z.number().int().positive(), denominator: z.number().int().positive() }).nullable()
schemas['video_edit.media'].frameRateMode = z.enum(['sampled-constant', 'variable', 'unknown'])
// Audio channels (task 2.6): null reads as "file default" (Use File / the first stream) and writing null restores it.
schemas['video_edit.media'].audioStreams = videoEditAudioStreamsSchema.nullable()
schemas['video_edit.item'].audioChannels = videoEditAudioLayoutSchema.nullable()
schemas['video_edit.clip'].audioMapping = videoEditAudioMappingSchema.nullable()
schemas['video_edit.clip'].audioRole = videoEditClipSchema.shape.audioRole.unwrap().nullable()
// 淡化手柄（4.3）：没有淡化时读出 0，写 0 去掉。
schemas['video_edit.clip'].fadeInFrames = z.number().int().min(0).max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES)
schemas['video_edit.clip'].fadeOutFrames = z.number().int().min(0).max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES)
// 片段速度（4.13）：百分比（100 原速），写入时时长按速度换算；倒放与保持音调为开关。
schemas['video_edit.clip'].speedPercent = z.number().min(1, '速度须在 1 到 10000（%）之间。').max(10000, '速度须在 1 到 10000（%）之间。')
schemas['video_edit.clip'].frameHold = z.boolean()
schemas['video_edit.clip'].reverse = z.boolean()
schemas['video_edit.clip'].preservePitch = z.boolean()
// 时间重映射（速度曲线）、补帧与变调：读出 null / nearest / 0，写入走同一速度编辑（时长随曲线变化）。
schemas['video_edit.clip'].timeRemap = videoEditTimeRemapSchema.nullable()
schemas['video_edit.clip'].frameInterpolation = videoEditFrameInterpolationSchema
schemas['video_edit.clip'].pitchSemitones = z.number().min(-24, '变调须在 -24 到 24 个半音之间。').max(24, '变调须在 -24 到 24 个半音之间。')
for (const type of ['video_edit.bin', 'video_edit.item', 'video_edit.sequence'] as const) schemas[type][type === 'video_edit.bin' ? 'parentId' : 'binId'] = z.string().max(100)
export function videoEditSchemaRef(kind: 'entity' | 'property', id: string): ApplicationSchemaRef {
  const hash = [...id].reduce((result, char) => (result * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${hash.repeat(64).slice(0, 64)}` }
}
const labels: Record<string, string> = { essentialSound: '基本声音', master: '主轨', volumeDb: '音量（分贝）', pan: '声像', frameHold: '帧定格', captionTrackEnabled: '字幕轨道显示', captionTrackLocked: '字幕轨道锁定', motionBlur: '运动模糊', frameBlend: '帧混合', scaleAspect: '纵横缩放比', frameCurves: '参数关键帧', effectsEnabled: '附加效果总开关', disabledIntrinsicSections: '被停用的固有分区', mediaImport: '素材导入进度', name: '名称', selectedItemIds: '所选素材项', selectedBinId: '当前素材箱', openSequenceIds: '打开的序列', tags: '标签', assetId: '资产来源', frameRateMode: '源帧率状态', timeUs: '源定位微秒', presentedTimeUs: '实际画面微秒', playing: '源播放', status: '源预览状态', error: '预览失败原因', frame: '当前帧', selection: '所选片段', width: '宽度', height: '高度', fps: '序列帧率', dirty: '尚未保存', activeSequenceId: '当前序列', frameRate: '帧率', pixelAspectRatio: '像素长宽比', sampleRate: '音频采样率', channels: '声道数量', parentId: '父素材箱', binId: '素材箱', itemId: '素材项', enabled: '输出启用', locked: '锁定', muted: '静音', solo: '独奏', mediaId: '源素材标识', kind: '类型', track: '轨道', start: '开始帧', duration: '时长', sourceInUs: '源素材入点微秒', x: '水平位置', y: '垂直位置', scale: '缩放', rotation: '旋转角度', opacity: '不透明度', volume: '音量', gainDb: '音频增益', text: '文字', clipId: '所属片段标识', space: '坐标空间', durationSeconds: '源时长秒', index: '轨道号' }
Object.assign(labels, { transcript: '转录稿', textSilences: '检测到的静音段', codeParameters: '代码实例参数', codeCurves: '参数关键帧', codeVersionId: '固定源码版本', linkId: '片段链接', groupId: '片段编组', sourceComponent: '使用画面或声音', syncLocked: '同步波纹编辑', hasAudio: '已检测到音轨', timelineView: '时间线选区、工具、链接选择与范围', programPlayback: '节目播放控制', playbackResolution: '节目回放分辨率', renderCache: '预渲染状态', renderPreference: '自动预渲染偏好', inUs: '源入点微秒', outUs: '源出点微秒', playbackDirection: '播放方向（反向静音）' })
Object.assign(labels, { transcript: '转录稿', textSilences: '检测到的静音段', audioStreams: '源声音流（文件顺序，每条的声道数与采样率）', audioChannels: '放入序列时的音频声道（每项一个音频片段：单声道或立体声及其源声道；空为按文件）', audioMapping: '声道映射（单声道或立体声及其源声音流与声道；空为第一条声音流原声道）' })
Object.assign(labels, { transcript: '转录稿', textSilences: '检测到的静音段', label: '颜色标签（空为跟随所在素材箱，箱也没设时按类型默认）', graphic: '图形对象结构', effects: '效果链', adjustment: '调整图层范围', transitions: '序列转场' })
Object.assign(labels, { transcript: '转录稿', textSilences: '检测到的静音段', colorLuts: '项目 LUT', graphicObjectIds: '图形对象顺序（从下到上）', effectIds: '效果执行顺序', adjustmentFromTrack: '调整起始轨道', graphicKind: '创建图形类型', graphicWidth: '图形宽度', graphicHeight: '图形高度', parameters: '实例参数', curves: '参数关键帧', versionId: '固定源码版本', definitionId: '滤镜源码定义', sequenceId: '所属序列', leftClipId: '左侧片段', rightClipId: '右侧片段', durationFrames: '转场时长帧' })
Object.assign(labels, { transcript: '转录稿', textSilences: '检测到的静音段', alignment: '过渡对齐（center 中心切点、start 起点切点即整段在切点后、end 终点切点即整段在切点前、custom 自定义起点）', framesBeforeCut: '过渡在切点之前的帧数（对齐为 custom 时生效）', fadeInFrames: '淡入帧数（0 为不淡入；画面从透明渐显，声音按恒定功率渐强）', fadeOutFrames: '淡出帧数（0 为不淡出）' })
Object.assign(labels, { transcript: '转录稿', textSilences: '检测到的静音段', group: '分组', description: '作用与适用场景', params: '参数（键、类型、范围、单位、默认值与取值含义）', mask: '作用区域', regions: '缩放区间', regionStatus: '作用区域分析状态' })
Object.assign(labels, { transcript: '转录稿', textSilences: '检测到的静音段', speedPercent: '速度百分比', reverse: '倒放', preservePitch: '变速时保持音调', timeRemap: '速度曲线（时间重映射）', frameInterpolation: '补帧方式', pitchSemitones: '变调（半音）' })
labels.audioRole = '声音类型'
labels.recordingCursorMode = '录制光标可用方式'
Object.assign(labels, { snapToBeat: '吸附到节拍', type: '标记类型', strength: '重音强度' })
Object.assign(labels, { transcript: '转录稿', textSilences: '检测到的静音段', takes: '可切回的镜头版本（替换镜头后记下的原素材，新的在前；用 restore_video_edit_clip_take 切回）' })
/** 个别属性的说明比通用模板更具体（助手据此取值）。 */
labels.textStyle = '文字样式'
Object.assign(labels, { transcript: '转录稿', textSilences: '检测到的静音段', translation: '第二语言字幕', style: '字幕样式' })
labels.multicamCameraId = '机位'
labels.multicam = '多机位源（机位与说话人、主音频）'
labels.codeImageGeneration = '图片生成来源'
labels.audioAnalysis = '音频分析'
labels.audioLinkNotices = '音频链接更新提示'
labels.audioAnalysisProgress = '音频分析进度'
labels.selectedCodeElement = '当前选中的代码元素'
schemas['video_edit.document'].selectedCodeElement = videoEditSelectedCodeElementContextSchema
const descriptions: Record<string, string> = {
  'video_edit.sequence.caption_track_enabled': '是否在节目预览和画面导出中显示字幕；关闭仍保留字幕，可继续编辑或导出字幕文件。默认开启。',
  'video_edit.sequence.caption_track_locked': '锁定字幕轨道，阻止字幕增删、改字、样式与时间修改；先设为 false 解锁后再编辑。默认关闭。',
  'video_edit.caption.source_text': '生成字幕时保存的排版前原句，整理字幕合并时用于恢复标点；手动改正文不会自动同步原句。',
  'video_edit.clip.snap_to_beat': '超级关键帧整理时将可移动关键时刻吸附到最近节拍标记，钉点和动作区间边界优先；不会自动应用候选。',
  'video_edit.marker.type': 'beat 为节拍标记，marker 为普通标记；未设置时读取为 marker。',
  'video_edit.marker.strength': '节拍的相对重音强度，0–1，越大重音越强。',
  'video_edit.item.code_parameters': '素材项的代码实例参数。按固定源码版本的 parameters/types 声明校验；先读出并保留其它键。只改变此素材项的初始值，现有片段实例独立。图片使用当前剪辑的 {kind:"image",mediaId} 或 null，其它新类型使用声明的 JSON 形状。',
  'video_edit.item.code_curves': '素材项代码参数的初始动画，源微秒 sourceInUs 加 sourceRemainder，按类型校验值及 linear/ease/hold/bezier（左点 bezier:[x1,y1,x2,y2]，x 为 0–1 时间比例，y 为值变化比例且可过冲）；只改变此素材项，现有片段实例独立。省略某参数关闭动画，禁止空关键帧数组。',
  'video_edit.code_material.files': '完整源码文件集合 {相对.ts路径:源码}；创建时与 source 二选一，entry 默认 main.ts。项目组件通过 import {lowerThird} from "@组件/人名条" 读取本项目最新版本，或 "@组件/人名条@2" 指定版本；创建素材版本时钉住完整依赖，之后组件更新不影响已有素材。另支持 v3 顶部 import {a,b as c} from "./模块"（可省略.ts），模块仅支持 const/export const（纯箭头 helper 可用），禁止默认导出、循环依赖、越出版本根目录和副作用。shaders/types/parameters 只写入口 export default，可引用导入的静态字面量常量。单文件64KiB。版本不可改写。',
  'video_edit.code_material.entry': '入口文件相对路径，创建时默认 main.ts；必须存在于 files 中，source 写法只允许 main.ts。',
  'video_edit.code_version.files': '固定版本全部文件 {路径:源码}；创建时与 source 二选一。多文件规则同 code_material.files；只创建新版本，不修改已有版本。',
  'video_edit.code_version.entry': '固定版本入口路径，创建时默认 main.ts，必须存在于 files 中。',
  'video_edit.code_material.parameters': '默认源码版本的参数声明（只读）：key、type、title、description、tooltip、group、advanced、visibleWhen、animatable、default 及类型专属约束。自定义 type 使用作者声明的类型名，字段定义见 types。按此声明写入片段 code_parameters 或效果 parameters。',
  'video_edit.code_material.types': '默认源码版本的自定义组件类型（只读），按类型名索引：title、layout、fields。字段只能是基础类型；结构实例须提供完整字段，声明 default 的缺项已由字段默认补齐。',
  'video_edit.code_version.parameters': '此固定源码版本的完整参数声明（只读），包含分组、高级、条件显示、默认值和范围。先读回声明，再通过片段 code_parameters、效果 parameters 或素材项 code_parameters 写入实例；修改参数不修改源码。',
  'video_edit.code_version.types': '此固定源码版本的自定义参数组件类型（只读）：title、layout 与基础类型 fields；参数 type 引用这里的类型名。',
  'video_edit.document.selected_code_element': '当前帧选中的代码元素，只读：clipRef、elementId、源码UTF-16位置sourceSpan（file 为相对文件路径）及关联参数parameterKeys。由节目点选与源码光标维护；用 clip.code_parameters 通用修改关联参数，或新建 annotation 的 element 目标绑定它。null 表示没有当前可见选中元素。',
  'video_edit.clip.element_overrides': '此代码生成片段的元素覆盖，按当前选区的 elementId 索引。dx/dy 为合成坐标的位移，scale/scaleX/scaleY 为相对倍率，rotation 为角度；opacity 为透明度；hidden 隐藏；不接受填色、描边、文字或字体样式覆盖，这些内容必须修改作者声明的 code_parameters。可选 curves 使用与代码参数相同的源微秒/余量/插值结构；linear/ease/hold/bezier，左点 bezier:[x1,y1,x2,y2] 的 x 为 0–1 时间比例，y 可过冲，求值按字段范围夹取；隐藏只支持hold。整体替换前先读并保留其它元素与字段；删除一个键即重置该元素。源码移除元素时保留覆盖。文字和文字样式通过绑定图层的参数修改，未声明参数时请让助手修改源码。写回源码应新建 code_version，再在同一事务绑定 code_version_id 并清除已合并覆盖，禁止改写旧版本。',
  'video_edit.clip.code_parameters': '按固定源码声明校验参数字典，只改此片段。图片参数接受 null 或 {kind:"image",mediaId}，mediaId 必须来自当前剪辑图片；可先用通用图片生成，再通过 place_video_edit_creative_result 的 library 模式导入，读取返回 video_edit.item 的 media_id 后绑定。先读原参数并保留其他键；不要用 generation.result、asset 引用或文件路径代替 mediaId。生成与取消使用正式生成任务，参数切换一步撤销。',
  'video_edit.media.code_image_generation': '此剪辑图片候选的完成来源，只读：prompt/modelId/taskId/outputIndex 与 sequenceId/clipId/versionId/parameterKey/effectId 标记原图片参数归属。候选切换通过 clip.code_parameters 或 effect.parameters 的图片 mediaId 通用写入，生成历史任务可查询进度、取消和读取结果。',
  'video_edit.clip.effects_enabled': '附加效果总开关；false 跳过此片段全部画面或声音附加效果，true 恢复。保留每项效果的 enabled、参数与关键帧，预览与导出一致，一步撤销。',
  'video_edit.clip.disabled_intrinsic_sections': '被停用的固有分区集合；motion 运动按居中/原缩放/无旋转渲染，opacity 不透明度按100%，audio 音量按100%，text 文字按空内容，textStyle 文字样式按默认。保留原参数和关键帧；从集合移除即可恢复，[] 全部启用。预览、导出和混音共用，一步撤销。',
  'video_edit.document.media_import': '当前素材导入队列，只读；null 表示没有导入。enumerating 正在查找文件，probing 正在读取素材。completed/total 为整队已处理与已发现文件数，totalKnown=false 时仍在枚举，discovered 是已发现数量。queued 为等待处理的请求数，requests 为本队列请求总数，imported/skipped 为已导入与跳过数。追加请求会排队；目录即时建素材箱，素材分批出现，每个请求一步撤销。取消整队保留已完成部分，清理本次新建且仍为空的素材箱。',
  'video_edit.clip.multicam_camera_id': '此段使用的机位ID，从源序列multicam.cameras读取；空字符串恢复机位1。仅多机位序列片段可写，保留源入点与固定主音频，可一步撤销。切点用滚动编辑或start/duration/source_in_us通用属性调整。',
  'video_edit.sequence.multicam': '多机位源定义：cameras含机位id/name/clipId与可选speaker说话人；audioCameraId为固定主音频机位。只能编辑现有源的机位名称、说话人和主音频，保留id与clipId；创建请用create_video_edit_multicam，普通序列读null。',
  'video_edit.item.sequence_id': '序列素材引用的原始 sequence ID（从 video_edit.sequence 完整引用的子 ID 取得）；仅 kind=sequence 可设置。创建序列素材需 name、kind=sequence、sequence_id，然后通过 video_edit.clip 集合放入父序列。循环引用或超过八层会整组拒绝；普通媒体留空。',
  'video_edit.item.source_range': '子剪辑的原素材范围，inUs/outUs 是整数微秒、右端不含；null 恢复完整素材。新放入时间线及首次打开源预览使用此范围，不改变已经放置的片段。',
  'video_edit.clip.audio_role': '声音片段用途：dialogue 对话、music 音乐、sound_effect 音效、ambience 环境；null 清除标注。可在同一通用事务批量设置，一步撤销。自动回避会压低指定音乐片段，在同时间的对话或音效有声时生效；不会自动识别声音类型。',
  'video_edit.caption.translation': '第二语言字幕；原文保持在 text，译文显示在原文下方，并进入字幕文件导出与烧录。空字符串清除；自动生成用 translate_video_edit_subtitles（可能计费，须审批）。',
  'video_edit.caption.style': VIDEO_EDIT_TEXT_STYLE_DESCRIPTION + '字幕空间量参考1080p；额外bottomMargin占画幅高度比例0–1。空字符串恢复默认。',
  'video_edit.clip.text_style': VIDEO_EDIT_TEXT_STYLE_DESCRIPTION + 'null恢复默认；空间量使用当前序列像素。位置/锚点/等比缩放/旋转/不透明度沿片段通用属性和关键帧。',
  'video_edit.clip.x': '片段运动锚点相对序列中心的水平位移，以序列宽度归一化；0 居中，-.5 左缘，.5 右缘。文字片段的样式锚点也使用此运动位置。',
  'video_edit.clip.y': '片段运动锚点相对序列中心的垂直位移，以序列高度归一化；0 居中，-.5 上缘，.5 下缘。文字片段的样式锚点也使用此运动位置。',
  'video_edit.tracker.method': 'shape 形状跟踪（点选或框选遮罩），box 物体框跟踪（box），point 点跟踪（1–4 个正向 points，各提示点数与顺序一致），planar 平面跟踪（quad 四角按左上、右上、右下、左下顺序）；用于视频、图片或嵌套序列片段。新建与纠错后自动向两边跟满片段。',
  'video_edit.tracker.prompts': '1–16 个提示：timeUs 素材绝对时间微秒（嵌套为子序列时间，父片段速度自动换算）；points 为 [[x,y,1选中或0排除]]，box 为 [x,y,宽,高]，坐标相对片段原画面归一化 0–1；至少有点或框，同一时间只有一个提示。仅 shape 单点可写 candidate 1–3 选择候选；point 可写 window:{feature,search}（画面高度比例，默认 0.04/0.2，搜索框不小于特征框）；planar 写 quad:[[x,y],…] 四角，不混用点与框；整体替换，纠错请保留其他时间的提示。写入自动重跟；status 读进度，导出自动等待。',
  'video_edit.tracker.status': '只读：idle；tracking:<百分比>；ready:<覆盖率>；stopped:<覆盖率>；failed:<用户可处理的原因>。由跟踪定义驱动的后台长任务维护。',
  'video_edit.clip.trackers': '只读聚合；请在片段下通过 video_edit.tracker 增删与修改跟踪器，每片段最多 8 个。',
  'video_edit.clip.follow': '片段跟随：null 取消；建议用 follow_video_edit_tracker 建立（自动算偏移与参考，可同时跟随旋转、缩放，或直接写成关键帧）。结构 {clipId,trackerId,offsetX,offsetY,scaleReference?,motion?,mode?} 引用同序列视频、图片或嵌套片段上的跟踪器。位置为跟踪锚点加偏移（序列宽高比例）；scaleReference 是建立绑定时跟踪框大小（序列中几何平均边长除以序列高度），省略只跟位置。motion:{rotation?,size?} 是变换跟随：rotation 为绑定时跟踪角度（度），size 为绑定时跟踪大小，写了哪项就跟随哪项，偏移随跟踪一起转动缩放，此时不用 scaleReference；旋转需要两点及以上的点跟踪或平面跟踪，缩放不能用一点跟踪。mode:corner_pin 将本图片/视频/嵌套片段四角贴到 planar 或四点跟踪上，偏移与缩放参考忽略（offsetX/offsetY 写 0）；省略 mode 或 position 为普通跟随。禁止自跟随与循环；缺结果时保持原位，导出自动等待。',
  'video_edit.clip.stabilization': '防抖（对标 PR 变形稳定器）：null 关闭；{smoothness:subtle 轻微只去抖保留运镜|natural 自然平滑运动|locked 锁定无运动, maxCrop 允许的最大裁切比例 0.02–0.5, rotation 是否校正旋转, scale 是否校正缩放}，四项都写。只用于视频与嵌套序列片段；写入后后台自动分析相机运动（跳过前景运动物体，按素材缓存），渲染时按 L1 最优路径实时修正并统一放大到不露黑边，与片段位置、缩放、旋转、关键帧和跟随叠加，不重新编码素材。分析并读回实际裁切比例用 stabilize_video_edit_clip；导出自动等待分析。',
  'video_edit.tracker.recording': '只读：录屏事件跟踪的来源（cursor 光标；window 前台窗口，windowId 为建立时的窗口）。由 track_video_edit_recording 建立，结果直接由录制事件换算、无需视觉跟踪；普通跟踪器为 null。',
  'video_edit.clip.speed_percent': '片段速度百分比，1–10000，100 为原速（视频、音频、嵌套序列与代码素材片段可改）。改速度时开头的内容不动，时长按速度换算（200% 时长减半）；变长时后面有片段则只用到空白为止。要按实际时长原子波纹调整后续片段，请用 ripple_video_edit_clip_speed；普通属性写入的链接音画请两段都写。',
  'video_edit.clip.reverse': '倒放：用到的源内容不变，播放方向反过来（画面与声音都倒放）。',
  'video_edit.clip.preserve_pitch': '变速时保持音调（时间拉伸，速度不是 100% 时生效，变速时默认开启）；关闭时声音随速度变高或变低。速度超出 25%–400%（含速度曲线的最快/最慢处）时整段不保持音调。',
  'video_edit.clip.time_remap': '速度曲线（时间重映射，对标 PR 时间重映射/剪映曲线变速），null 为常数速度。points 按 offsetUs 升序：offsetUs 是点所在的素材位置（距片段开头的源微秒数，沿播放方向；倒放时向素材较早处数），speed 是该处倍率（1=100%，0.5 慢放一半，0.01–100）；interpolation 控制到下一点：linear 线性变化、hold 保持到下一点、ease 缓入缓出、bezier 自定义（左点 bezier:[x1,y1,x2,y2]）。第一个点之前、最后一个点之后保持端点速度。写入时片段用到的素材内容不变，时长按曲线重新计算（后面有片段时只用到空白为止，结尾截短）；与 speed_percent 互斥：写曲线取代常数速度，写 speed_percent 取代曲线，null 回到 100%。修剪拆分后的点可能带 easeRange/easeValues，读改写时保留。按节拍或时刻做速度坡道请用 ramp_video_edit_clip_speed。',
  'video_edit.clip.frame_interpolation': '慢放时的补帧方式：nearest 帧采样（默认，取最近的源帧）；blend 帧混合（相邻两帧按位置混合，慢放更顺但有重影）；optical_flow 光流（预留，当前按 blend 渲染）。只影响画面，预览与导出一致。',
  'video_edit.clip.pitch_semitones': '变调，单位半音，-24–24，0 不变（+12 高一个八度）；不改变速度与时长，可与变速和保持音调叠加。只影响声音，预览与导出一致。',
  'video_edit.media.recording_cursor_mode': '录制光标可用方式（只读）：redraw 可重绘光标与点击；clicks 原片已经包含光标，只能添加点击提示；unavailable 没有事件日志。redraw/clicks 可在该素材的视频片段下用通用集合创建 video_edit.effect，definition_id=effect:recording_cursor，参数见内置效果目录；同样可创建 effect:recording_zoom（自动缩放，在 regions 写缩放区间）。日志由录制会话提供，不能手写路径。',
  'video_edit.effect.definition_id': '效果来源，创建后不可改：内置效果写 effect:<ID>（画面效果如 effect:gaussian_blur 只能加到画面片段；音频效果如 effect:noise_reduction、effect:parametric_eq 只能加到声音片段；全部内置效果、适用片段及参数语义见 video_edit.builtin_effect），代码滤镜写滤镜源码定义 ID（只用于画面片段）。',
  'video_edit.document.color_luts': '项目已导入LUT的id与名称，只读；在效果parameters的input_lut/look_lut写该id，强度为0–100。',
  'video_edit.effect.parameters': '效果参数。内置效果：键与范围见 video_edit.builtin_effect 的 params（强度多为 0–100，空间量按画面高度比例，与分辨率无关）；写入是整体替换：只存写入的键，没写的键按默认值（只改一项时先读出再整体写回）；越界或未知键会报错并列出可用范围。代码滤镜：按固定源码版本声明校验。',
  'video_edit.effect.regions': '自动缩放（effect:recording_zoom）的缩放区间，整体替换：先读出，再改动后完整写回；[] 清空。每项 {id,startUs,endUs,depth,focus,origin}：startUs<endUs 为片段素材源时间微秒（与修剪、拆分、变速、倒放无关，内容在哪区间就在哪；时间线帧换算先读片段 source_in_us、速度与倒放），区间之间不能重叠、数量不限；depth 1–6 档 = 1.25/1.5/1.8/2.2/3.5/5 倍，默认 3；focus "cursor" 跟随鼠标（平滑，靠近视野边缘才平移），或 {x,y} 相对源画面 0–1 的固定位置（如 {x:0.8,y:0.1} 右上角）；origin 自动生成写 auto，按用户意图新建或修改写 manual。区间开始前平滑放大、结束后平滑缩小，间隔≤1.5秒的相邻区间按 parameters.connect 直接平移。其他效果读出 [] 且不可写入。',
  'video_edit.effect.amount': '效果与原画面（音频效果为原声）的混合比例 0–1：1 完全应用，0.5 一半强度；停用效果请写 enabled。',
  'video_edit.effect.version_id': '代码滤镜的固定源码版本；内置效果为空字符串且不可写。',
  'video_edit.effect.mask': '作用区域仅用于内置画面效果，null 为整个画面。智能区域 {regionId:face|person|background|text,feather?,expand?,invert?} 仅用于视频图片；写入自动分析，region_status 读状态，导出等待。feather 0–100、expand -100–100，100 约为画面高度10%。手绘 {regionId:shapes,shapes:[{id,kind,points,mode?,feather?,expand?,opacity?,invert?,follow?,pathAnimation?}]} 用于任何画面片段，数量不限、id 唯一。kind rect/ellipse/path 仅标记创建来源；闭合 points:[[x,y,入柄dx,dy,出柄dx,dy],…] 至少3点，坐标相对片段画面归一化。mode add/subtract/intersect，默认add；首项subtract从整画面挖掉。默认feather5、expand0、opacity100（0–100）。路径动画 pathAnimation:{pointIds:[稳定点标识,…],keys:[{sourceTimeUs,points,interpolation}]}，点标识与每帧points按序对应，静态points点数也须相同；禁止增删点、换序、绕向翻转或中间退化，孔洞用独立subtract形状。sourceTimeUs为片段连续源时刻（微秒，可有小数），严格递增，速度/倒放/修剪沿原源时间；interpolation仅linear或hold。先求路径动画再跟踪，清除pathAnimation恢复静态。跟踪区域 {regionId:tracker,trackerId,feather?,expand?,invert?}，trackerId用本片段跟踪器id；手绘follow:{trackerId,reference:[x,y,宽,高]}采用绑定帧跟踪框，复用后台结果。先完整读取mask再修改，保留其它形状。',
  'video_edit.effect.region_status': '作用区域的分析状态（只读）：空字符串为没有作用区域；ready 已就绪；analyzing:<百分比> 后台分析中；failed:<原因> 分析失败（原因是给用户看的说明）。同一素材区域由多个效果共享分析，清空再写回 mask 不保证重试；失败时用 retry_video_edit_smart_region，与效果控件的“重试”同源。',
  'video_edit.clip.code_curves': '代码片段参数的动画关键帧：源微秒 sourceInUs 加 sourceRemainder，按声明校验值；interpolation 为 linear/ease/hold/bezier，左点 bezier:[x1,y1,x2,y2] 控制到下一点，x 为 0–1 时间比例，y 可过冲，求值按参数范围夹取。整体替换前先读保留其它参数；省略参数关闭动画，禁止空数组。',
  'video_edit.graphic_object.curves': '图形对象参数动画：源微秒 sourceInUs 加 sourceRemainder；值与参数声明单位和范围一致；interpolation 为 linear/ease/hold/bezier，左点 bezier:[x1,y1,x2,y2] 控制到下一点，x 为 0–1 时间比例，y 可过冲，求值按声明范围夹取；文字只能 hold。整体替换前先读取，省略参数关闭动画。',
  'video_edit.effect.curves': '代码滤镜的参数关键帧（源时间微秒 sourceInUs 加 sourceRemainder）；interpolation 为 linear、hold、ease 或 bezier，左点 bezier:[x1,y1,x2,y2] 控制到下一点的缓动（x 为 0–1 时间比例，y 为值变化比例且可过冲）；内置效果使用 frame_curves（片段内整数帧），这里保持空对象。',
  'video_edit.transition.frame_curves': '转场参数关键帧：{参数键: 关键帧序列}，整体替换，先读取保留其他参数；{} 关闭全部动画，省略的参数没有动画。time 为转场内整数帧（0 为转场第一帧，最大 duration_frames−1），value 的单位与范围见 builtin_effect 的 transition:<kind>。同一参数按 time 升序且不重复；interpolation 为 linear、hold、ease 或 bezier；bezier:[x1,y1,x2,y2] 放在左点，控制到下一点的缓动，x 为 0–1 时间比例，y 为值变化比例且可过冲（渲染按参数范围夹取）；开关/选项只能 hold。修改时长按进度重排关键帧，切换 kind 清除旧参数动画。',
  'video_edit.effect.frame_curves': '内置效果的参数关键帧：{参数键: 关键帧序列}，整体替换（先读取，保留不改的参数）；不写的参数没有动画，{} 关闭全部动画。time 为片段内整数帧（0 为片段第一帧，最大 duration−1）；value 与该参数单位、范围一致；interpolation：linear 线性，hold 定格到下一点，ease 对称缓入缓出，bezier 自定义贝塞尔（左点 bezier:[x1,y1,x2,y2]，x1/x2 为 0–1 的区间时间，y1/y2 为值变化比例，可过冲，求值按参数范围夹取；省略取对称缓动）；开关与选项只能 hold。同一参数按 time 升序且不重复。',
  'video_edit.transition.kind': '过渡种类，可改成同一媒介的其他种类（改种类时没写的参数回到新种类的默认值）。视频：cross_dissolve 交叉溶解、dip_to_black 黑场、dip_to_white 白场、wipe 擦除、push 推动、slide 滑动、cross_zoom 缩放过渡、blur_dissolve 模糊过渡、flash 闪光、iris_round 圆形划像；音频：constant_power 恒定功率、constant_gain 恒定增益、exponential_fade 指数淡化。每种的用途与参数见 video_edit.builtin_effect 里的 transition:<种类>。',
  'video_edit.transition.parameters': '内置及 shaders.* 带参数转场的参数，键与范围见 video_edit.builtin_effect 的 transition:<种类> 的 params（方向用选项值，羽化、边框等按画面高度比例，与分辨率无关）。写入是整体替换：只存写入的键，没写的键按默认值（只改一项时先读出再整体写回）；空对象表示全部默认；越界或未知键会报错并列出可用范围。进度由转场窗口驱动，不作为参数写入；没有参数的种类保持空对象。',
  'video_edit.document.active_sequence_id': '当前序列 ID；空字符串表示没有序列。写入即切换到该序列，与点时间线上的序列标签相同：节目画面与时间线换成它，没打开的序列会加一个标签，各序列记住自己的播放头与视图；不改作品内容、不进撤销栈，不能写空。新项目不含任何序列，可在 video_edit.document 下通过 video_edit.sequence 集合创建（name 与可选 width/height/frame_rate），再放入素材。',
  'video_edit.document.proxy_preference': '代理看片偏好。enabled=true 时节目在播放与拖动播放头时、源监视器看片时用已有低分辨率代理，节目停下后换回原片完整画质；false 一律用原片。导出默认用原片，可在导出设置中选择代理；声音、选帧、跟踪与智能区域分析始终用原片。没有代理的素材仍用原片。autoCreate=true 导入超过1920×1080的视频时自动后台创建代理（原片的一半、短边最高1080）；本机按剪辑记住，不改内容，可事务撤销。',
  'video_edit.media.proxy_state': '代理状态，只读：none无代理、generating后台创建中、ready已有；progress为0–1，error为失败原因。代理创建使用generate_video_edit_proxy，切换使用video_edit.document.proxy_preference。',
  'video_edit.document.render_cache': '当前序列的渲染条，只读：按剪辑点分段，长段最多五秒，ready 已渲染（节目完整分辨率流畅播放）、rendering 正在渲染、dropped 实测正向播放跳帧超过5%（红）、predicted 尚无足够样本但预计吃力（黄）、realtime 实测流畅或预计轻量；performance 为最近最多600个应呈现帧的样本数、其中被跳过的帧数与实时合成耗时p90毫秒；rendering 为进行中的预渲染进度。渲染使用 render_video_edit_preview；修改内容后仅受影响段落的预览与实测失效。',
  'video_edit.document.render_preference': '预渲染偏好。autoRender=true（默认）时，打开节目监视器后、编辑停下 3 秒且没有播放、拖动或导出时，自动在后台从播放头附近开始渲染渲染条上可能卡顿的段落；播放、拖动、导出时暂停让出显卡，再次编辑会取消并等停下后重来。false 只在手动渲染或 render_video_edit_preview 时渲染。本机按剪辑记住，不改内容，可事务撤销。',
  'video_edit.document.playback_resolution': '节目监视器的回放分辨率（只影响看片时的流畅度与清晰度，不改剪辑内容，不进剪辑历史）。resolution：full 完整、half 1/2、quarter 1/4、eighth 1/8（按序列宽高各缩小到该比例渲染，素材多、效果重、播放卡顿时调低）。fullWhenPaused：true 暂停时自动回到完整分辨率（默认，便于看清细节），false 暂停时也用所选分辨率。导出、选帧加入资产库、设为项目封面始终按完整分辨率，与此无关。按剪辑记住。',
  'video_edit.clip.effect_ids': '效果执行顺序（从上到下依次处理画面；声音片段上是音频效果，依次处理声音）。',
  'video_edit.transition.left_clip_id': '过渡左侧（前一段）的片段 ID，创建后不可改。两个片段在同一轨道首尾相接时两端都写；只写 left_clip_id 是挂在该片段出点的单侧过渡（后面是空白，淡出）。视频过渡挂画面片段，音频过渡挂声音片段。',
  'video_edit.transition.right_clip_id': '过渡右侧（后一段）的片段 ID，创建后不可改。只写 right_clip_id 是挂在该片段入点的单侧过渡（前面是空白，淡入）。两端都不写会被拒绝；写错时错误信息会列出该序列可放这种过渡的编辑点。',
}
Object.assign(labels, { target: '标注目标', endFrame: '标注结束帧', author: '标注作者', createdAt: '创建时间', thread: '讨论回复', addressedBy: '处理关联' })
Object.assign(descriptions, { 'video_edit.annotation.target': '坐标按合成画面归一化（0..1，左上为原点）。指出画面问题按意图选形状：arrow箭头{from,to}指向某处或示意移动方向（to端画箭头）；ellipse椭圆{x,y,width,height外接框}圈住人物或主体；region矩形框住界面区域或整块范围；text文字{x,y左上锚点}把说明直接写在画面上，内容取text；marker编号圆点{x,y,number}按1、2、3标出多个位置或步骤顺序；stroke自由笔画点列；point单点位置。element绑定代码元素ID及可选源码字符范围/矩形，须指定clip_id；range是包含两端的时间段及可选轨道/片段ID，startFrame/endFrame须与frame/end_frame一致。ellipse与region须在画面内；arrow起点终点不能重合。', 'video_edit.annotation.style': '批注颜色{color}，可选red/orange/yellow/green/blue/purple/white/black，省略为red。同一画面多条批注用不同颜色区分对象；深色画面用亮色、浅色画面用red/blue/black保证看得清。写null恢复默认。', 'video_edit.annotation.status': 'draft待发送；open待处理；addressed已处理待用户审查（同一change_application_entities事务内修改内容、追加thread、写addressed；宿主自动关联撤销边界）；resolved仅用户通过，Agent不能写。重新处理前重开为open。', 'video_edit.annotation.thread': '按时间顺序的消息列表，消息包含id、author {kind:user/assistant/external,name}、createdAt ISO时间、text。Agent只能追加自己的处理回复，说明改了什么、怎么改、可撤销步骤；追加用 mutate_properties 的 append，value 是一条消息对象（每次处理回复一条），不能覆盖已有回复。' })
descriptions['video_edit.graphic_object.text_style'] = VIDEO_EDIT_TEXT_STYLE_DESCRIPTION + '空间量使用当前图形画幅像素。文字必须非null；形状必须null。位置、比例、锚点偏移、旋转、不透明度沿 parameters 和源时钟 curves；x/y、anchorX/Y为图形像素，scale等比倍数0.01–100，rotation角度-360–360，opacity比例0–1。'
descriptions['video_edit.graphic_object.visible'] = '图层可见性；false隐藏，true显示。'
labels.styleId = '风格'
descriptions['video_edit.sequence.style_id'] = '当前序列按哪份工程风格副本创作（video_edit.project_style 引用里的风格 id）；空字符串取消绑定。从风格库绑定新风格或升级副本用 bind_video_edit_style。绑定只决定助手按哪份说明书创作，不改时间线；在这个序列里新做内容前先读说明书。'
labels.templateId = '原生模板'
descriptions['video_edit.clip.template_id'] = '这个文字图形片段是哪个原生工程模板（video_edit.project_template）的实例，联动跟着模板变；空串表示不属于模板。只读：分离用 detach_video_edit_template_instance，登记用 create_video_edit_template。代码模板的实例看 code 的代码定义。'
labels.elementOverrides = '元素覆盖'
descriptions['video_edit.item.element_overrides'] = '此代码素材项插入新片段时复制的初始元素覆盖；片段插入后独立编辑 clip.element_overrides。结构与片段元素覆盖相同，整体替换前先读取保留其它元素。'
const codeKeys: Record<string, string> = { codeParameters: 'parameters', codeCurves: 'curves', codeVersionId: 'versionId' }
/** 剪辑名就是剪辑文件的文件名（3.1）：改名走通用文档属性。 */
export const VIDEO_EDIT_PROJECT_NAME_READ_ONLY = '剪辑名就是剪辑文件名，请改 documents.document 的 name（文档 ID 与本剪辑相同）；剪辑内容能力不改名。'
/** 内置效果目录的只读原因（属性与实体共用）：指向真正能加效果的写入路径。 */
export const VIDEO_EDIT_BUILTIN_CATALOG_READ_ONLY = '内置效果与过渡目录由应用登记、随版本更新，只读；给片段加效果请在片段下创建 video_edit.effect，definition_id 写这里的 ID（effect:<ID>），parameters 按 params 取值；加过渡请在序列下创建 video_edit.transition，kind 写 transition:<种类> 里的种类名，parameters 按 params 取值。'
export const VIDEO_EDIT_CONTROLLED_AGGREGATES = ['code', 'graphic', 'effects', 'adjustment', 'transitions', 'creativeSource', 'takes', 'trackers'] as const
const fieldDescriptions: Record<string, string> = {
  name: '在素材箱、时间线或目录中显示的名称。', locked: '锁定后禁止修改此轨道上的片段；解除后可继续编辑。',
  muted: '是否关闭此轨道的声音输出，不删除片段。', solo: '是否仅播放独奏轨道的声音；可同时独奏多条轨道。',
  enabled: '是否让此项参与输出；关闭时保留内容与参数。', sourceText: '生成字幕时保存的排版前原句，整理字幕合并时用于恢复标点；手动改正文不会自动同步原句。',
  text: '当前显示的文字正文；修改正文不会自动同步字幕原句。', visible: '是否显示此图形对象；隐藏时保留内容。',
  opacity: '画面不透明度，0 完全透明、1 完全不透明。', volume: '音量倍率，0 静音、1 原音量、2 最大；与音频增益叠加，可设关键帧。', gainDb: '音量之前的源声音增益，单位 dB，-96～+96，缺省 0；不改变音量及其关键帧。',
  scale: '画面等比缩放倍率，1 为原尺寸。', rotation: '画面旋转角度，以度为单位。', amount: '效果与原画面的混合强度，0 无效果、1 完全应用。',
  width: '画面宽度，以像素为单位。', height: '画面或轨道的高度，以像素为单位。',
  kind: '此项的媒体或内容类型，用于选择相应的编辑操作。', index: '轨道在当前序列中的位置编号，片段通过该编号归属轨道。',
  track: '片段所在轨道的编号，从当前序列的轨道目录读取。', dirty: '当前文档是否还有尚未保存的修改。',
}
function schemasDescription(key: string): string | undefined {
  // 同一字段的领域描述只有完全一致时才能跨实体复用。
  const descriptions = [...new Set(Object.values(schemas).map(fields => fields[key]?.description).filter((value): value is string => !!value))]
  return descriptions.length === 1 ? descriptions[0] : undefined
}
const frameKeys = new Set(['frame', 'start', 'duration', 'endFrame', 'durationFrames', 'framesBeforeCut', 'fadeInFrames', 'fadeOutFrames'])
function defaultFieldDescription(key: string): string {
  const title = labels[key] ?? key
  if (frameKeys.has(key)) return `${title}，时间线使用整数帧。`
  if (['sourceInUs', 'timeUs', 'presentedTimeUs', 'inUs', 'outUs'].includes(key)) return `${title}，单位为微秒。`
  if (['x', 'y', 'anchorX', 'anchorY'].includes(key)) return `${title}，相对画幅的归一化坐标。`
  return fieldDescriptions[key] ?? schemasDescription(key) ?? `${title}。`
}
Object.assign(labels, { amount: '效果强度', sourceText: '原句', source: '作者源码', files: '源码文件', entry: '源码入口', apiVersion: '代码接口版本', languageVersion: '代码语言版本', defaultVersionId: '默认源码版本', versionIds: '源码版本列表', types: '自定义参数类型', visible: '可见', anchorX: '水平锚点', anchorY: '垂直锚点', method: '跟踪方法', prompts: '跟踪提示', styleId: '风格', proxyPreference: '代理媒体偏好', proxyState: '代理媒体状态', follow: '跟随跟踪器', stabilization: '防抖', recording: '录屏事件来源', trackers: '跟踪器', sourceRange: '初始源范围', creativeSource: '生成来源', elementOverrides: '元素覆盖', color: '颜色', scaleX: '水平缩放', scaleY: '垂直缩放', flipX: '水平翻转', flipY: '垂直翻转', endFrame: '结束帧', author: '批注作者', createdAt: '创建时间', addressedBy: '处理操作', target: '批注目标', thread: '讨论记录', code: '代码实例' })
Object.assign(labels, { speech: '来源文字', reviewReasons: '待复核内容' })
descriptions['video_edit.clip.remix'] = '音频重构子片段的记录：id 为同一次重构共用，segment 为序号，targetFrames 为目标总帧数，repetition/granularity/seed 为参数，analysisIdentity 为分析所依据的内容身份，sourceInUs/sourceOutUs 为重构前的原始源范围，seamConfidence 为这一段开头接缝的把握（0–1，越高越不易听出）。普通片段为 null。'
labels.remix = '音频重构'
labels.musicStructure = '音乐结构'
descriptions['video_edit.clip.frame_hold'] = '是否为帧定格；定格引用源入点处的同一帧，可调整持续时间、修剪和移动。用 add_video_edit_frame_hold 在播放头切出定格，整个操作可撤销。'
Object.assign(labels, { contentAnchor: '关联内容' })
descriptions['video_edit.sequence.motion_blur'] = '整条序列的运动模糊总开关（新建序列默认开）：开着时有位置、缩放、旋转、锚点动画的片段，以及代码素材里声明了 motionBlur 的会动图层沿运动方向模糊；关掉则全部不模糊。单个片段用 video_edit.clip.motion_blur 关掉。'
descriptions['video_edit.clip.motion_blur'] = '这个片段自身动画（位置、缩放、旋转、锚点关键帧）的运动模糊：true 跟随序列总开关（默认），false 只关掉这个片段。序列总开关 video_edit.sequence.motion_blur 关掉时一律不模糊。代码素材里单个图层的模糊在源码图层的 motionBlur 里控制。界面不提供这一项，由助手按画面需要调整。'
descriptions['video_edit.source.item_id'] = '源监视器打开的素材项，空字符串为关闭。视频、图片、音频按原文件播放；代码画面、图形、文字没有源文件，按只放这一项的临时序列预览（画幅与帧率跟当前序列，时长为放进时间线时的默认时长，没有声音，不设入出点）。打开不改作品，也不往时间线里放东西。'
Object.assign(labels, { contentQueries: '素材内容查询进度' })
schemas['video_edit.item'].contentQueries = z.array(mediaContentQueryProgressSchema).max(8)
descriptions['video_edit.item.content_queries'] = '当前剪辑实例中此素材项最近的内容查询，最多八项；只读运行状态，不保存到作品、不进入撤销。phaseProgress 只代表当前阶段的实测进度，null 表示尚无可计数进度，不是整项任务百分比。completedUnits/totalUnits 表示本阶段已检查文档或已分析声道路数；无可靠总量时 totalUnits 为 null。取消原读取请求会取消实际分析；失败后可重新 query_video_edit_content，不识别、不计费。关闭重开剪辑后清空。'
schemas['video_edit.caption'].speech = videoEditCaptionSchema.shape.speech.unwrap().nullable()
labels.linkedCaptionId = '链接的音频编辑字幕段'
descriptions['video_edit.caption.linked_caption_id'] = '来自所属片段链接的音频编辑文档里的这段字幕（audio_edit.caption 的字幕段 ID）。文字、断句与时间由音频编辑维护，音频编辑改动后自动更新；在剪辑里改 text 会写回音频编辑那一段（片段只显示了一部分时请到音频编辑里改）。为空表示剪辑自己的字幕。'
export const VIDEO_EDIT_FIELDS = Object.fromEntries(VIDEO_EDIT_TYPES.map(entityType => [entityType, Object.entries(schemas[entityType]).map(([key, schema]): ApplicationFieldDefinition<VideoEditFieldData, VideoEditFieldData> => {
  const id = `${entityType}.${videoEditPropertyKey(key)}`
  const controlled = VIDEO_EDIT_CONTROLLED_AGGREGATES.some(value => value === key) || entityType === 'video_edit.caption' && (key === 'speech' || key === 'linkedCaptionId') || key === 'contentQueries'
  const child = VIDEO_EDIT_COMPOSITE_TYPES.some(type => type === entityType)
  const curveKey = key.endsWith('.keyframes') ? key.split('.').at(-2)! : undefined
  const curveDataKey = entityType === 'video_edit.clip' ? 'curves' : 'frameCurves'
  const curveDescription = '整体替换关键帧序列；[] 关闭动画。time 为片段内整数帧（0 为片段第一帧，最大 duration−1），不是秒或素材时间。value 与原参数单位、范围一致。interpolation 控制到下一点：linear 线性，hold 定格至下一点，ease 对称缓入缓出，bezier 自定义贝塞尔：左点 bezier:[x1,y1,x2,y2] 控制到下一点的缓动，x1/x2 为 0–1 时间比例，y1/y2 为值变化比例且可过冲，求值按参数范围夹取；省略取对称缓动。开关与选项只能 hold。同一参数按 time 升序且不重复。音量回避/自动重构/录屏注意力推近生成的点带 source 与 duckingOrigin/reframeOrigin 来源基线；回写未改的点保留原信息，手动新增点省略来源信息。修剪点可能带 easeRange/easeValues 原区间锚点，读改写时保留，直接修改该点时省略。修改生成点的时刻、值或插值后归用户所有，重新生成不会删除它。片段跟随时 x/y 是跟踪位置上的偏移，scale 是跟踪缩放的乘数。'
  const writable = !(entityType === 'video_edit.annotation' && ['author', 'createdAt', 'addressedBy', 'space'].includes(key)) && !['transcript', 'textSilences', 'frameHold', 'remix', 'templateId'].includes(key) && !controlled && !(entityType === 'video_edit.track' && ['index', 'kind'].includes(key)) && !(child && ['kind', 'definitionId', 'clipId', 'sequenceId', 'leftClipId', 'rightClipId', 'regionStatus', 'status', 'recording'].includes(key) && !(entityType === 'video_edit.transition' && key === 'kind')) && entityType !== 'video_edit.media' && entityType !== 'video_edit.code_version' && entityType !== 'video_edit.builtin_effect' && (entityType !== 'video_edit.code_material' || key === 'name') && (entityType !== 'video_edit.document' || ['selectedItemIds', 'selectedBinId', 'activeSequenceId', 'openSequenceIds', 'timelineView', 'programPlayback', 'playbackResolution', 'proxyPreference', 'renderPreference'].includes(key)) && !(entityType === 'video_edit.item' && ['kind', 'mediaId', 'graphicKind', 'graphicWidth', 'graphicHeight'].includes(key)) && (entityType !== 'video_edit.source' || ['itemId', 'timeUs', 'playing', 'volume', 'inUs', 'outUs', 'playbackDirection'].includes(key))
  return {
    propertyId: id, descriptor: { id, entityType, version: 1, title: curveKey ? `${labels[curveKey] ?? curveKey}关键帧` : key === 'codeParameters' ? '代码实例参数' : labels[key] ?? key, description: curveKey ? curveDescription : (key === 'transcript' ? '当前稿子随片段源范围、速度、倒放自动映射；index 是当前词索引，from/to 是半开序列帧范围，editable=false 时不能按词删除。先读取，再用文本剪辑算法能力处理；识别不重复执行。' : key === 'textSilences' ? '口播音频检测且按保留短停顿规则换算的半开序列帧范围；先检测，再删除。' : descriptions[id]) ?? (key === 'source' ? '作者源码：标准 ES 模块（单文件写法，入口 main.ts），在剪辑渲染 Worker 直接执行，指定帧试渲染通过后进入剪辑。源码版本不可原位改写，改代码就新建版本。' : key === 'codeParameters' ? '按固定源码版本的声明校验参数字典；修改只作用于此片段，不重编译源码，复用剪辑历史和自动保存。' : key === 'programPlayback' ? '节目播放控制命令；回读为当前实际位置，播放观察可随帧推进。执行确认表示会话接受命令，实际画面由节目监视器呈现。' : defaultFieldDescription(key)), value: { kind: 'json', schemaRef: videoEditSchemaRef('property', id + '.value') }, ...(frameKeys.has(key) ? { unit: '帧' } : {}), nullable: key === 'code' || schema.isNullable() || entityType === 'video_edit.annotation' && schema.isOptional(), ...((entityType === 'video_edit.source' && ['timeUs', 'playing'].includes(key) || entityType === 'video_edit.document' && key === 'programPlayback' || entityType === 'video_edit.clip' && key === 'contentAnchor') ? { verificationStrategy: 'execution' as const } : {}), dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: writable ? ['video_edit:write'] : [] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', id), ...(!writable ? { readOnlyReason: key === 'linkedCaptionId' ? '由音频编辑与剪辑的动态链接维护；改字幕文字直接写 text。' : key === 'remix' ? '由 remix_video_edit_music 生成；改目标时长、重复程度、粒度或变体时用任一子片段再次调用它，会按记录的原始源范围重算并替换整组。' : key === 'frameHold' ? '由 add_video_edit_frame_hold 按播放头原子切割并固定源帧；持续时间和位置仍可独立编辑。' : entityType === 'video_edit.annotation' ? '作者、时间与处理撤销关联由宿主维护；处理完追加 thread 并写 status=addressed。' : entityType === 'video_edit.document' && key === 'name' ? VIDEO_EDIT_PROJECT_NAME_READ_ONLY : entityType === 'video_edit.builtin_effect' ? VIDEO_EDIT_BUILTIN_CATALOG_READ_ONLY : entityType === 'video_edit.tracker' && key === 'status' ? '由后台跟踪维护；新建或修改 prompts 自动开始，读 status 看进度。' : entityType === 'video_edit.tracker' && key === 'recording' ? '录屏事件跟踪由 track_video_edit_recording 按录制事件建立；改名、删除仍走通用属性与集合。' : key === 'regionStatus' ? '由后台分析维护：写 mask 设置作用区域后自动开始分析，读这里看进度。' : '由剪辑会话、不可变源码或原素材维护。' } : {}) },
    read: source => curveKey ? (source[curveDataKey] && typeof source[curveDataKey] === 'object' && !Array.isArray(source[curveDataKey]) ? source[curveDataKey][curveKey] ?? [] : []) : codeKeys[key] ? source.code && typeof source.code === 'object' && !Array.isArray(source.code) ? source.code[codeKeys[key]] ?? (key === 'codeVersionId' ? '' : {}) : key === 'codeVersionId' ? '' : {} : source[key] ?? (key === 'gainDb' ? 0 : ['snapToBeat', 'frameHold'].includes(key) ? false : key === 'type' && entityType === 'video_edit.marker' ? 'marker' : key === 'strength' && entityType === 'video_edit.marker' ? 0 : key === 'elementOverrides' ? {} : entityType === 'video_edit.annotation' && schema.isOptional() ? null : key === 'visible' ? true : key === 'textStyle' && entityType === 'video_edit.graphic_object' ? null : ['anchorX', 'anchorY'].includes(key) ? 0.5 : key === 'sourceComponent' ? 'all' : key === 'height' && entityType === 'video_edit.track' ? 32 : ['syncLocked', 'effectsEnabled'].includes(key) ? true : key === 'code' || schema.isNullable() ? null : key === 'frameCurves' ? {} : ['tags', 'effects', 'transitions', 'disabledIntrinsicSections'].includes(key) ? [] : ['fadeInFrames', 'fadeOutFrames'].includes(key) ? 0 : key === 'frameRateMode' ? 'unknown' : ''), storeActions: [],
    ...(entityType === 'video_edit.sequence' && key === 'frameRate' ? { cascadeEffects: VIDEO_EDIT_TIME_CASCADES } : {}),
    ...(entityType === 'video_edit.clip' && ['start', 'duration', 'sourceInUs', 'speedPercent', 'reverse', 'timeRemap', 'contentAnchor'].includes(key) ? { cascadeEffects: VIDEO_EDIT_CLIP_CONTENT_CASCADES } : {}),
    ...((entityType === 'video_edit.clip' || entityType === 'video_edit.sequence' || child) && writable ? { cascadeEffects: [...(entityType === 'video_edit.clip' && ['duration', 'speedPercent', 'timeRemap'].includes(key) ? [VIDEO_EDIT_CLIP_KEYFRAME_TIME_CASCADE] : []), ...(entityType === 'video_edit.clip' && ['start', 'duration', 'sourceInUs', 'speedPercent', 'reverse', 'timeRemap', 'contentAnchor'].includes(key) ? VIDEO_EDIT_CLIP_CONTENT_CASCADES : []), ...(entityType === 'video_edit.sequence' && key === 'frameRate' ? VIDEO_EDIT_TIME_CASCADES : []), ...VIDEO_EDIT_COMPOSITE_CASCADES] } : {}),
    ...(entityType === 'video_edit.source' && writable ? { cascadeEffects: [VIDEO_EDIT_SOURCE_PROGRAM_CASCADE] } : {}),
    ...(entityType === 'video_edit.document' && key === 'programPlayback' ? { cascadeEffects: [VIDEO_EDIT_PROGRAM_SOURCE_CASCADE] } : {}),
    ...(writable ? { writer: { ...(entityType === 'video_edit.annotation' && key === 'thread' ? { operations: ['set', 'append'] as const } : {}), write: (draft: VideoEditFieldData, mutation: { value?: JsonValue; operation: string }) => { if (entityType === 'video_edit.annotation' && schema.isOptional() && mutation.value === null) { delete draft[key]; return } if (entityType === 'video_edit.annotation' && key === 'thread' && mutation.operation === 'append') { draft.thread = [...(Array.isArray(draft.thread) ? draft.thread : []), videoEditAnnotationMessageSchema.parse(mutation.value) as JsonValue]; return } const value = schema.parse(mutation.value) as JsonValue; if (key === 'elementOverrides' && value && typeof value === 'object' && !Object.keys(value).length) { delete draft[key]; return } if (curveKey) { const curves = draft[curveDataKey]; const next = { ...(curves && typeof curves === 'object' && !Array.isArray(curves) ? curves : {}), [curveKey]: value }; if (Array.isArray(value) && !value.length) delete next[curveKey]; draft[curveDataKey] = next } else if (codeKeys[key]) { if (!draft.code || typeof draft.code !== 'object' || Array.isArray(draft.code)) throw new Error('此片段没有代码实例。'); draft.code = { ...draft.code, [codeKeys[key]]: value } } else if ((['binId', 'parentId', 'linkId', 'groupId', 'sequenceId', 'multicamCameraId', 'styleId'].includes(key) || ['video_edit.marker', 'video_edit.caption'].includes(entityType) && key === 'clipId') && value === '' || key === 'sourceComponent' && value === 'all' || ['audioChannels', 'audioMapping', 'follow', 'stabilization', 'textStyle', 'audioRole', 'sourceRange', 'contentAnchor'].includes(key) && value === null || ['fadeInFrames', 'fadeOutFrames'].includes(key) && value === 0) delete draft[key]; else draft[key] = value } } } : {}),
  }
})])) as Record<VideoEditEntityType, ApplicationFieldDefinition<VideoEditFieldData, VideoEditFieldData>[]>
export function videoEditSchemaDocuments(entityType: VideoEditEntityType): import('@/core/application-control').ApplicationSchemaDocument[] {
  return Object.entries(schemas[entityType]).map(([key, schema]) => {
    const validator = entityType === 'video_edit.annotation' && schema.isOptional() ? schema.nullable() : schema
    return { ref: videoEditSchemaRef('property', `${entityType}.${videoEditPropertyKey(key)}.value`), value: z.toJSONSchema(validator) as JsonValue, validator }
  })
}
export function videoEditCollectionValues(entityType: VideoEditEntityType, properties: Record<string, JsonValue>): VideoEditFieldData {
  const data: VideoEditFieldData = {}
  for (const [propertyId, value] of Object.entries(properties)) {
    const suffix = propertyId.slice(entityType.length + 1)
    const key = Object.keys(schemas[entityType]).find(key => videoEditPropertyKey(key) === suffix)
    if (!key) throw new Error('创建属性未登记。')
    if (key === 'contentQueries') throw new Error('内容查询进度由运行中的查询维护，不能手动创建或修改。')
    if (entityType === 'video_edit.caption' && key === 'speech') throw new Error('字幕来源只由自动字幕与对齐服务维护；手动创建请省略 speech，建立独立字幕。')
    const schema = schemas[entityType][key]
    if (entityType === 'video_edit.annotation' && schema.isOptional() && value === null) continue
    const parsed = schema.parse(value) as JsonValue
    if (key.endsWith('.keyframes')) {
      const store = entityType === 'video_edit.clip' ? 'curves' : 'frameCurves'
      const curveKey = key.split('.').at(-2)!
      const curves = data[store]
      data[store] = { ...(curves && typeof curves === 'object' && !Array.isArray(curves) ? curves : {}), [curveKey]: parsed }
    } else if (!((entityType === 'video_edit.clip' && ['textStyle', 'audioRole'].includes(key) || entityType === 'video_edit.item' && key === 'sourceRange') && parsed === null)) data[key] = parsed
  }
  return data
}
