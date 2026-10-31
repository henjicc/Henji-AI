import { z } from 'zod'
import type { ApplicationFieldDefinition, ApplicationPropertyDescriptor, JsonValue } from '@/core/application-control'
import { videoEditEffectPresetSchema, type VideoEditEffectPreset } from '@/core/videoEdit/effectPresets'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { videoEditSchemaRef } from './videoEditFields'
import { videoEditPresetCreationProperties, VIDEO_EDIT_EFFECT_LIBRARY_SCOPE } from './videoEditEffectPresets'

export const effectPresetEntityType = 'video_edit.effect_preset'
export const effectPresetDescription = '全局风格件。先按名称、说明和用途找；读取 definition 后用 look(name, knobs)，含代码成员的风格件只能上片段，使用 creation_items。定义的 effects 可写 {ref: 片段上的 video_edit.effect 引用}，宿主解析并嵌入完整代码快照。新建或修改代表用户口味，先展示具体内容，向用户确认一次再用通用实体写入；不要自行保存口味。风格包成员读写 video_edit.style.effect_presets；绑定后的工程副本可覆盖同名全局件。'
function field(key: string, title: string, value: ApplicationPropertyDescriptor['value'], read: (preset: VideoEditEffectPreset) => JsonValue, write?: (draft: VideoEditEffectPreset, value: unknown) => void): ApplicationFieldDefinition<VideoEditEffectPreset, VideoEditEffectPreset, 'renamePreset'> {
  const id = `${effectPresetEntityType}.${key}`
  return { propertyId: id, storeActions: key === 'name' ? ['renamePreset'] : [], read, ...(write ? { writer: { write: (draft, mutation) => write(draft, mutation.value) } } : {}), descriptor: {
    id, entityType: effectPresetEntityType, version: 1, title, description: key === 'definition' ? effectPresetDescription + 'definition 是完整风格件，id 由宿主管理；mappings 用效果实例 id 和参数键，points 两点为线性、多点为分段线性。' : key === 'creation_items' ? '将非空数组用作 create_items.items，在同一次事务向目标 clip 创建 video_edit.effect；纯图层风格件返回空数组，请在作者图层使用 look。' : title,
    value, ...(key === 'definition' ? { verificationStrategy: 'execution' as const } : {}), nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: write ? ['video_edit:write'] : [] }, revisionScopes: [VIDEO_EDIT_EFFECT_LIBRARY_SCOPE], schemaRef: videoEditSchemaRef('property', id), ...(write ? {} : { readOnlyReason: '由完整 definition 派生；修改请写 definition。' }),
  } }
}
function parseDefinition(value: unknown, id: string): VideoEditEffectPreset {
  try {
    const input = z.record(z.string(), z.unknown()).parse(value)
    const unknown = Object.keys(input).filter(key => !Object.hasOwn(videoEditEffectPresetSchema.shape, key))
    if (unknown.length) throw new Error(`definition 多传的键：${unknown.join('、')}。`)
    return videoEditEffectPresetSchema.parse({ ...input, id })
  } catch (error) { throw notExecutedFailure(error) }
}
export const effectPresetFields = [
  field('name', '名称', { kind: 'string', maxLength: 200 }, preset => preset.name, (draft, value) => { draft.name = videoEditEffectPresetSchema.shape.name.parse(value) }),
  field('description', '说明', { kind: 'string' }, preset => preset.description ?? ''),
  field('usage', '用途', { kind: 'string' }, preset => preset.usage ?? ''),
  field('media', '适用媒介', { kind: 'enum', values: [{ value: 'video', label: '画面' }, { value: 'audio', label: '声音' }] }, preset => preset.media),
  field('definition', '风格件', { kind: 'json', schemaRef: videoEditSchemaRef('property', `${effectPresetEntityType}.definition.value`) }, preset => preset as unknown as JsonValue, (draft, value) => { const parsed = parseDefinition(value, draft.id); for (const key of ['description', 'usage', 'knobs', 'codeSnapshots'] as const) delete draft[key]; Object.assign(draft, parsed) }),
  field('creation_items', '创建效果组合', { kind: 'json', schemaRef: videoEditSchemaRef('property', `${effectPresetEntityType}.creation_items.value`) }, preset => videoEditPresetCreationProperties(preset).map(properties => ({ properties })) as JsonValue),
]
