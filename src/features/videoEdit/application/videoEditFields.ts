import { z } from 'zod'
import { type ApplicationFieldDefinition, type JsonValue, type ApplicationSchemaRef } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { videoEditAnnotationSchema, videoEditClipSchema } from '@/core/videoEdit/document'

export const VIDEO_EDIT_TYPES = ['video_edit.project', 'video_edit.clip', 'video_edit.annotation', 'video_edit.media'] as const
export type VideoEditEntityType = typeof VIDEO_EDIT_TYPES[number]
export type VideoEditFieldData = Record<string, JsonValue>
export function videoEditPropertyKey(key: string): string { return key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`) }
export function videoEditDataKey(key: string): string { return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) }
const text = z.string().max(2000)
const schemas: Record<VideoEditEntityType, Record<string, z.ZodType>> = {
  'video_edit.project': { name: z.string().min(1).max(200), frame: z.number().int().nonnegative(), selection: z.string(), width: z.number().int(), height: z.number().int(), fps: z.number(), dirty: z.boolean() },
  'video_edit.clip': Object.fromEntries(Object.entries(videoEditClipSchema.shape).filter(([key]) => key !== 'id')),
  'video_edit.annotation': Object.fromEntries(Object.entries(videoEditAnnotationSchema.shape).filter(([key]) => key !== 'id')),
  'video_edit.media': { name: text, kind: z.enum(['video', 'image', 'audio']), durationSeconds: z.number(), width: z.number(), height: z.number() },
}
export function videoEditSchemaRef(kind: 'entity' | 'property', id: string): ApplicationSchemaRef {
  const hash = [...id].reduce((result, char) => (result * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${hash.repeat(64).slice(0, 64)}` }
}
const labels: Record<string, string> = { name: '名称', frame: '当前帧', selection: '所选片段', width: '宽度', height: '高度', fps: '工程帧率', dirty: '尚未保存', mediaId: '源素材标识', kind: '类型', track: '轨道', start: '时间线开始帧', duration: '时长帧', sourceInUs: '源素材入点微秒', x: '水平位置', y: '垂直位置', scale: '缩放', rotation: '旋转角度', opacity: '不透明度', volume: '音量', brightness: '亮度', text: '文字', clipId: '所属片段标识', space: '坐标空间', durationSeconds: '源时长秒' }
export const VIDEO_EDIT_FIELDS = Object.fromEntries(VIDEO_EDIT_TYPES.map(entityType => [entityType, Object.entries(schemas[entityType]).map(([key, schema]): ApplicationFieldDefinition<VideoEditFieldData, VideoEditFieldData> => {
  const id = `${entityType}.${videoEditPropertyKey(key)}`
  const writable = entityType === 'video_edit.clip' || entityType === 'video_edit.annotation' || (entityType === 'video_edit.project' && key === 'name')
  return {
    propertyId: id, descriptor: { id, entityType, version: 1, title: labels[key] ?? key, description: `${labels[key] ?? key}；时间线使用整数帧，源入点使用微秒，画面位置使用归一化坐标。`, value: { kind: 'json', schemaRef: videoEditSchemaRef('property', id + '.value') }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: writable ? ['video_edit:write'] : [] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', id), ...(!writable ? { readOnlyReason: '由工程会话或原素材维护。' } : {}) },
    read: source => source[key] ?? '', storeActions: [],
    ...(writable ? { writer: { write: (draft: VideoEditFieldData, mutation: { value?: JsonValue }) => { draft[key] = schema.parse(mutation.value) as JsonValue } } } : {}),
  }
})])) as Record<VideoEditEntityType, ApplicationFieldDefinition<VideoEditFieldData, VideoEditFieldData>[]>
export function videoEditSchemaDocuments(entityType: VideoEditEntityType): Array<{ ref: ApplicationSchemaRef; value: JsonValue }> {
  return Object.entries(schemas[entityType]).map(([key, schema]) => ({ ref: videoEditSchemaRef('property', `${entityType}.${videoEditPropertyKey(key)}.value`), value: z.toJSONSchema(schema) as JsonValue }))
}
