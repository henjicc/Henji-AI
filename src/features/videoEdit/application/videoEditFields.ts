import { z } from 'zod'
import { type ApplicationFieldDefinition, type JsonValue, type ApplicationSchemaRef } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { videoEditAnnotationSchema, videoEditClipSchema, videoEditSequenceSchema, videoEditBinSchema, videoEditItemSchema, videoEditTrackSchema } from '@/core/videoEdit/document'
import { codeMaterialInstanceSchema, codeMaterialVersionSchema } from '@/core/videoEdit/codeMaterialPersistence'
import { codeMaterialCurvesSchema } from '@/core/videoEdit/codeMaterialAnimation'
import { videoEditTimelineViewSchema, videoEditProgramPlaybackSchema } from '@/core/videoEdit/timelineSelection'
import { videoEditMarkerSchema, videoEditCaptionSchema } from '@/core/videoEdit/timedContent'
import { videoEditEffectSchema, videoEditAdjustmentSchema } from '@/core/videoEdit/compositing'
import { videoEditTransitionSchema } from '@/core/videoEdit/transitions'
import { VIDEO_EDIT_COMPOSITE_TYPES } from './videoEditCompositeEntities'

export const VIDEO_EDIT_TYPES = ['video_edit.project', 'video_edit.clip', 'video_edit.annotation', 'video_edit.media', 'video_edit.sequence', 'video_edit.bin', 'video_edit.item', 'video_edit.track', 'video_edit.source', 'video_edit.code_material', 'video_edit.code_version', 'video_edit.marker', 'video_edit.caption', ...VIDEO_EDIT_COMPOSITE_TYPES] as const
export type VideoEditEntityType = typeof VIDEO_EDIT_TYPES[number]
export type VideoEditFieldData = Record<string, JsonValue>
export function videoEditPropertyKey(key: string): string { return key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`) }
export function videoEditDataKey(key: string): string { return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) }
const text = z.string().max(2000)
export const VIDEO_EDIT_TIME_CASCADES = [
  { declarationId: 'video_edit.sequence_clip_time', effect: 'update', entityType: 'video_edit.clip', propertyIds: ['video_edit.clip.start', 'video_edit.clip.duration'], revisionScopes: ['video_edit'] },
  { declarationId: 'video_edit.sequence_annotation_time', effect: 'update', entityType: 'video_edit.annotation', propertyIds: ['video_edit.annotation.frame'], revisionScopes: ['video_edit'] },
  { declarationId: 'video_edit.sequence_marker_time', effect: 'update', entityType: 'video_edit.marker', propertyIds: ['video_edit.marker.frame'], revisionScopes: ['video_edit'] },
  { declarationId: 'video_edit.sequence_caption_time', effect: 'update', entityType: 'video_edit.caption', propertyIds: ['video_edit.caption.start', 'video_edit.caption.duration'], revisionScopes: ['video_edit'] },
] as const
export const VIDEO_EDIT_CLIP_CONTENT_CASCADES = (['create', 'update', 'delete'] as const).flatMap(effect => (['marker', 'caption'] as const).map(kind => ({ declarationId: `video_edit.clip_${kind}_${effect}`, effect, entityType: `video_edit.${kind}`, propertyIds: effect === 'update' ? kind === 'marker' ? ['video_edit.marker.frame', 'video_edit.marker.clip_id'] : ['video_edit.caption.start', 'video_edit.caption.duration', 'video_edit.caption.clip_id'] : [], revisionScopes: ['video_edit'] })))
const compositeUpdateKeys = { 'video_edit.graphic_object': ['name', 'parameters', 'curves'], 'video_edit.effect': ['name', 'enabled', 'amount', 'version_id', 'parameters', 'curves'], 'video_edit.transition': ['duration_frames'] }
export const VIDEO_EDIT_COMPOSITE_CASCADES = (['create', 'update', 'delete'] as const).flatMap(effect => VIDEO_EDIT_COMPOSITE_TYPES.map(entityType => ({ declarationId: `${entityType}_${effect}`, effect, entityType, propertyIds: effect === 'update' ? compositeUpdateKeys[entityType].map(key => `${entityType}.${key}`) : [], revisionScopes: ['video_edit'] })))
export const VIDEO_EDIT_SOURCE_PROGRAM_CASCADE = { declarationId: 'video_edit.source_foreground_program_pause', effect: 'update' as const, entityType: 'video_edit.project', propertyIds: ['video_edit.project.program_playback'], revisionScopes: ['video_edit'] }
export const VIDEO_EDIT_PROGRAM_SOURCE_CASCADE = { declarationId: 'video_edit.program_foreground_source_pause', effect: 'update' as const, entityType: 'video_edit.source', propertyIds: ['video_edit.source.playing'], revisionScopes: ['video_edit'] }
const schemas: Record<VideoEditEntityType, Record<string, z.ZodType>> = {
  'video_edit.project': { name: z.string().min(1).max(200), frame: z.number().int().nonnegative(), selection: z.string(), activeSequenceId: z.string(), dirty: z.boolean(), selectedItemIds: z.array(z.string().min(1)).max(500), selectedBinId: z.string().max(100), openSequenceIds: z.array(z.string().min(1)).min(1).max(32) },
  'video_edit.clip': Object.fromEntries(Object.entries(videoEditClipSchema.shape).filter(([key]) => key !== 'id' && key !== 'sourceRemainder')),
  'video_edit.annotation': Object.fromEntries(Object.entries(videoEditAnnotationSchema.shape).filter(([key]) => key !== 'id' && key !== 'sourceRemainder')),
  'video_edit.sequence': Object.fromEntries(Object.entries(videoEditSequenceSchema.shape).filter(([key]) => !['id', 'clips', 'annotations', 'tracks', 'markers', 'captions'].includes(key))),
  'video_edit.marker': { ...Object.fromEntries(Object.entries(videoEditMarkerSchema.shape).filter(([key]) => key !== 'id')), clipId: z.string().max(100) },
  'video_edit.caption': { ...Object.fromEntries(Object.entries(videoEditCaptionSchema.shape).filter(([key]) => key !== 'id')), clipId: z.string().max(100) },
  'video_edit.bin': Object.fromEntries(Object.entries(videoEditBinSchema.shape).filter(([key]) => key !== 'id')),
  'video_edit.item': Object.fromEntries(Object.entries(videoEditItemSchema.shape).filter(([key]) => key !== 'id')),
  'video_edit.track': Object.fromEntries(Object.entries(videoEditTrackSchema.shape).filter(([key]) => !['id', 'index', 'kind'].includes(key))),
  'video_edit.media': { name: text, kind: z.enum(['video', 'image', 'audio']), durationSeconds: z.number(), width: z.number(), height: z.number() },
  'video_edit.source': { itemId: z.string().max(100), timeUs: z.number().int().nonnegative(), presentedTimeUs: z.number().int().nonnegative(), playing: z.boolean(), volume: z.number().min(0).max(1), inUs: z.number().int().nonnegative().nullable(), outUs: z.number().int().nonnegative().nullable(), playbackDirection: z.union([z.literal(1), z.literal(-1)]), status: z.enum(['closed', 'loading', 'ready', 'error']), error: text },
  'video_edit.code_material': { name: z.string().min(1).max(200), source: z.string().max(65536), defaultVersionId: z.string().min(1).max(100), versionIds: z.array(z.string()).max(64), binId: z.string().max(100) },
  'video_edit.code_version': { source: codeMaterialVersionSchema.shape.source, apiVersion: codeMaterialVersionSchema.shape.apiVersion, languageVersion: codeMaterialVersionSchema.shape.languageVersion, definitionId: z.string().min(1).max(100) },
  'video_edit.graphic_object': { name: z.string().trim().min(1).max(200), kind: z.enum(['rect', 'ellipse', 'text']), clipId: z.string().min(1).max(100), sequenceId: z.string().min(1).max(100), parameters: codeMaterialInstanceSchema.shape.parameters, curves: codeMaterialCurvesSchema },
  'video_edit.effect': { name: videoEditEffectSchema.shape.name, enabled: videoEditEffectSchema.shape.enabled, amount: videoEditEffectSchema.shape.amount, definitionId: codeMaterialInstanceSchema.shape.definitionId, versionId: codeMaterialInstanceSchema.shape.versionId, parameters: codeMaterialInstanceSchema.shape.parameters, curves: codeMaterialCurvesSchema, clipId: z.string().min(1).max(100), sequenceId: z.string().min(1).max(100) },
  'video_edit.transition': { ...Object.fromEntries(Object.entries(videoEditTransitionSchema.shape).filter(([key]) => key !== 'id')), sequenceId: z.string().min(1).max(100) },
}
schemas['video_edit.clip'].codeParameters = codeMaterialInstanceSchema.shape.parameters
schemas['video_edit.clip'].graphic = videoEditClipSchema.shape.graphic.nullable()
schemas['video_edit.clip'].adjustment = videoEditClipSchema.shape.adjustment.nullable()
schemas['video_edit.item'].graphic = videoEditItemSchema.shape.graphic.nullable()
schemas['video_edit.clip'].graphicObjectIds = z.array(z.string().min(1).max(100)).max(32)
schemas['video_edit.clip'].effectIds = z.array(z.string().min(1).max(100)).max(4)
schemas['video_edit.clip'].adjustmentFromTrack = videoEditAdjustmentSchema.shape.fromTrack.nullable()
schemas['video_edit.item'].graphicKind = z.enum(['solid', 'rect', 'ellipse', 'text']).nullable()
schemas['video_edit.item'].graphicWidth = z.number().int().min(16).max(8192).nullable()
schemas['video_edit.item'].graphicHeight = z.number().int().min(16).max(8192).nullable()
schemas['video_edit.project'].timelineView = videoEditTimelineViewSchema
schemas['video_edit.project'].programPlayback = videoEditProgramPlaybackSchema
schemas['video_edit.clip'].codeCurves = codeMaterialCurvesSchema
schemas['video_edit.clip'].codeVersionId = z.string().min(1).max(100)
schemas['video_edit.clip'].linkId = z.string().max(100)
schemas['video_edit.clip'].groupId = z.string().max(100)
schemas['video_edit.clip'].sourceComponent = z.enum(['all', 'video', 'audio'])
schemas['video_edit.media'].assetId = z.string().max(100).optional()
schemas['video_edit.media'].hasAudio = z.boolean().nullable()
schemas['video_edit.clip'].creativeSource = videoEditClipSchema.shape.creativeSource.unwrap().nullable()
schemas['video_edit.media'].frameRate = z.object({ numerator: z.number().int().positive(), denominator: z.number().int().positive() }).nullable()
schemas['video_edit.media'].frameRateMode = z.enum(['sampled-constant', 'variable', 'unknown'])
for (const type of ['video_edit.bin', 'video_edit.item', 'video_edit.sequence'] as const) schemas[type][type === 'video_edit.bin' ? 'parentId' : 'binId'] = z.string().max(100)
export function videoEditSchemaRef(kind: 'entity' | 'property', id: string): ApplicationSchemaRef {
  const hash = [...id].reduce((result, char) => (result * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${hash.repeat(64).slice(0, 64)}` }
}
const labels: Record<string, string> = { name: '名称', selectedItemIds: '所选项目项', selectedBinId: '当前素材箱', openSequenceIds: '打开的序列', tags: '标签', assetId: '资产来源', frameRateMode: '源帧率状态', timeUs: '源定位微秒', presentedTimeUs: '实际画面微秒', playing: '源播放', status: '源预览状态', error: '预览失败原因', frame: '当前帧', selection: '所选片段', width: '宽度', height: '高度', fps: '序列帧率', dirty: '尚未保存', activeSequenceId: '当前序列', frameRate: '帧率', pixelAspectRatio: '像素长宽比', sampleRate: '音频采样率', channels: '声道数量', parentId: '父素材箱', binId: '素材箱', itemId: '项目项', enabled: '输出启用', locked: '锁定', muted: '静音', solo: '独奏', mediaId: '源素材标识', kind: '类型', track: '轨道', start: '时间线开始帧', duration: '时长帧', sourceInUs: '源素材入点微秒', x: '水平位置', y: '垂直位置', scale: '缩放', rotation: '旋转角度', opacity: '不透明度', volume: '音量', brightness: '亮度', text: '文字', clipId: '所属片段标识', space: '坐标空间', durationSeconds: '源时长秒' }
Object.assign(labels, { codeParameters: '代码实例参数', codeCurves: '参数关键帧', codeVersionId: '固定源码版本', linkId: '音画链接', groupId: '片段编组', sourceComponent: '使用画面或声音', syncLocked: '同步波纹编辑', hasAudio: '已检测到音轨', timelineView: '时间线选区、工具与范围', programPlayback: '节目播放控制', inUs: '源入点微秒', outUs: '源出点微秒', playbackDirection: '播放方向（反向静音）' })
Object.assign(labels, { graphic: '图形对象结构', effects: '效果链', adjustment: '调整图层范围', transitions: '序列转场' })
Object.assign(labels, { graphicObjectIds: '图形对象顺序（从下到上）', effectIds: '效果执行顺序', adjustmentFromTrack: '调整起始轨道', graphicKind: '创建图形类型', graphicWidth: '图形宽度', graphicHeight: '图形高度', parameters: '实例参数', curves: '参数关键帧', versionId: '固定源码版本', definitionId: '滤镜源码定义', sequenceId: '所属序列', leftClipId: '左侧片段', rightClipId: '右侧片段', durationFrames: '转场时长帧' })
const codeKeys: Record<string, string> = { codeParameters: 'parameters', codeCurves: 'curves', codeVersionId: 'versionId' }
export const VIDEO_EDIT_CONTROLLED_AGGREGATES = ['code', 'graphic', 'effects', 'adjustment', 'transitions', 'creativeSource'] as const
export const VIDEO_EDIT_FIELDS = Object.fromEntries(VIDEO_EDIT_TYPES.map(entityType => [entityType, Object.entries(schemas[entityType]).map(([key, schema]): ApplicationFieldDefinition<VideoEditFieldData, VideoEditFieldData> => {
  const id = `${entityType}.${videoEditPropertyKey(key)}`
  const controlled = VIDEO_EDIT_CONTROLLED_AGGREGATES.some(value => value === key)
  const child = VIDEO_EDIT_COMPOSITE_TYPES.some(type => type === entityType)
  const writable = !controlled && !(child && ['kind', 'definitionId', 'clipId', 'sequenceId', 'leftClipId', 'rightClipId'].includes(key)) && entityType !== 'video_edit.media' && entityType !== 'video_edit.code_version' && (entityType !== 'video_edit.code_material' || key === 'name') && (entityType !== 'video_edit.project' || ['name', 'selectedItemIds', 'selectedBinId', 'openSequenceIds', 'timelineView', 'programPlayback'].includes(key)) && !(entityType === 'video_edit.item' && ['kind', 'mediaId', 'graphicKind', 'graphicWidth', 'graphicHeight'].includes(key)) && (entityType !== 'video_edit.source' || ['itemId', 'timeUs', 'playing', 'volume', 'inUs', 'outUs', 'playbackDirection'].includes(key))
  return {
    propertyId: id, descriptor: { id, entityType, version: 1, title: key === 'codeParameters' ? '代码实例参数' : labels[key] ?? key, description: key === 'source' ? '受限作者源码；只经AST白名单检查、指定帧试渲染后进入工程，不执行JavaScript或宿主脚本。源码版本不可原位改写。' : key === 'codeParameters' ? '按固定源码版本的声明校验参数字典；修改只作用于此片段，不重编译源码，复用工程历史和自动保存。' : key === 'programPlayback' ? '节目播放控制命令；回读为当前实际位置，播放观察可随帧推进。执行确认表示会话接受命令，实际画面由节目监视器呈现。' : `${labels[key] ?? key}；时间线使用整数帧，源入点使用微秒，画面位置使用归一化坐标。`, value: { kind: 'json', schemaRef: videoEditSchemaRef('property', id + '.value') }, nullable: key === 'code' || schema.isNullable(), ...((entityType === 'video_edit.source' && ['timeUs', 'playing'].includes(key) || entityType === 'video_edit.project' && key === 'programPlayback') ? { verificationStrategy: 'execution' as const } : {}), dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: writable ? ['video_edit:write'] : [] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', id), ...(!writable ? { readOnlyReason: '由工程会话、不可变源码或原素材维护。' } : {}) },
    read: source => codeKeys[key] ? source.code && typeof source.code === 'object' && !Array.isArray(source.code) ? source.code[codeKeys[key]] ?? (key === 'codeVersionId' ? '' : {}) : key === 'codeVersionId' ? '' : {} : source[key] ?? (key === 'sourceComponent' ? 'all' : key === 'height' && entityType === 'video_edit.track' ? 32 : key === 'syncLocked' ? true : key === 'code' || schema.isNullable() ? null : ['tags', 'effects', 'transitions'].includes(key) ? [] : key === 'frameRateMode' ? 'unknown' : ''), storeActions: [],
    ...(entityType === 'video_edit.sequence' && key === 'frameRate' ? { cascadeEffects: VIDEO_EDIT_TIME_CASCADES } : {}),
    ...(entityType === 'video_edit.clip' && ['start', 'duration', 'sourceInUs'].includes(key) ? { cascadeEffects: VIDEO_EDIT_CLIP_CONTENT_CASCADES } : {}),
    ...((entityType === 'video_edit.clip' || entityType === 'video_edit.sequence' || child) && writable ? { cascadeEffects: [...(entityType === 'video_edit.clip' && ['start', 'duration', 'sourceInUs'].includes(key) ? VIDEO_EDIT_CLIP_CONTENT_CASCADES : []), ...(entityType === 'video_edit.sequence' && key === 'frameRate' ? VIDEO_EDIT_TIME_CASCADES : []), ...VIDEO_EDIT_COMPOSITE_CASCADES] } : {}),
    ...(entityType === 'video_edit.source' && writable ? { cascadeEffects: [VIDEO_EDIT_SOURCE_PROGRAM_CASCADE] } : {}),
    ...(entityType === 'video_edit.project' && key === 'programPlayback' ? { cascadeEffects: [VIDEO_EDIT_PROGRAM_SOURCE_CASCADE] } : {}),
    ...(writable ? { writer: { write: (draft: VideoEditFieldData, mutation: { value?: JsonValue }) => { const value = schema.parse(mutation.value) as JsonValue; if (codeKeys[key]) { if (!draft.code || typeof draft.code !== 'object' || Array.isArray(draft.code)) throw new Error('此片段没有代码实例。'); draft.code = { ...draft.code, [codeKeys[key]]: value } } else if ((['binId', 'parentId', 'linkId', 'groupId'].includes(key) || ['video_edit.marker', 'video_edit.caption'].includes(entityType) && key === 'clipId') && value === '' || key === 'sourceComponent' && value === 'all') delete draft[key]; else draft[key] = value } } } : {}),
  }
})])) as Record<VideoEditEntityType, ApplicationFieldDefinition<VideoEditFieldData, VideoEditFieldData>[]>
export function videoEditSchemaDocuments(entityType: VideoEditEntityType): Array<{ ref: ApplicationSchemaRef; value: JsonValue }> {
  return Object.entries(schemas[entityType]).map(([key, schema]) => ({ ref: videoEditSchemaRef('property', `${entityType}.${videoEditPropertyKey(key)}.value`), value: z.toJSONSchema(schema) as JsonValue }))
}
export function videoEditCollectionValues(entityType: VideoEditEntityType, properties: Record<string, JsonValue>): VideoEditFieldData {
  return Object.fromEntries(Object.entries(properties).map(([propertyId, value]) => {
    const key = videoEditDataKey(propertyId.slice(entityType.length + 1))
    const schema = schemas[entityType][key]
    if (!schema) throw new Error('创建属性未登记。')
    return [key, schema.parse(value) as JsonValue]
  }))
}
