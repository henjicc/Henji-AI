import i18n from '@/i18n'
import { unrestrictedCollectionAvailability, type ApplicationEntityRegistration, type ApplicationPropertyDescriptor, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { createImageEditOperationParametersV3, listImageEditLayerOperationsV3 } from '@/core/imageEdit/v3/operationCatalog'
import { listImagingEffects } from '@/core/imaging/effects/registry'
import { imageEditV3SchemaRef } from './imageEditV3Fields'
import { getImageEditDocumentCatalogRevisionV3 } from './imageEditDocumentInstances'

const ENTITY = 'image_edit.filter_definition'
const READ_ONLY = '滤镜目录来自图片编辑内置的渲染节点登记，随软件版本固定；把滤镜加到图层上请创建 image_edit.layer_filter。'

/** 共享效果的说明在效果描述里；图片自有的调整只在这里写参数含义，键名与默认值仍从登记读出。 */
const ADJUSTMENT_NOTES: Record<string, string> = {
  color_grade: '全能调色：曝光、色温色调、饱和度、参数曲线、色轮、HSL 与 LUT 在一处调；字段见 image_edit.layer.params 的 color_grade 定义，省略的字段按中性默认。',
  exposure: '曝光：stops 是曝光档（+1 亮度翻倍，轻微提亮可从 0.3 起），offset 是黑位偏移，gamma 调中间调（1 为不变）。',
  curves: '曲线：master、red、green、blue 各为 {x,y} 控制点数组（0–1），两点 (0,0)、(1,1) 为不变。',
  'temperature-tint': '色温与色调：temperature 正值偏暖、负值偏冷，tint 正值偏洋红、负值偏绿，0 为不变。',
  hsl: '色相、饱和度、明度：hueDegrees 旋转色相（度），saturation、lightness 为相对调整，0 为不变。',
}

interface FilterDefinition { id: string; name: string; operationType: 'effect' | 'adjustment'; effectId: string; description: string; defaultParams: JsonValue }

function definitions(): FilterDefinition[] {
  const shared = listImagingEffects()
  return listImageEditLayerOperationsV3().filter(operation => operation.creatable).map(operation => {
    const descriptor = shared.find(effect => effect.id === operation.operationId && effect.hosts.includes('image'))
    const name = descriptor?.name ?? i18n.t(`imageEditor.v3.${operation.layerType}.${operation.operationId}`, { defaultValue: operation.operationId })
    return { id: `${operation.layerType}:${operation.operationId}`, name, operationType: operation.layerType, effectId: operation.operationId,
      description: descriptor?.description ?? ADJUSTMENT_NOTES[operation.operationId] ?? name,
      defaultParams: createImageEditOperationParametersV3(operation.operationId) as JsonValue }
  })
}

function catalogProperty(suffix: string, title: string, description: string, value: ApplicationPropertyDescriptor['value']): ApplicationPropertyDescriptor {
  const id = `${ENTITY}.${suffix}`
  return { id, entityType: ENTITY, version: 1, title, description, value, nullable: false, dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['image_edit:read'], write: [] },
    revisionScopes: ['image_edit'], schemaRef: imageEditV3SchemaRef('property', id), readOnlyReason: READ_ONLY }
}

const DEFAULT_PARAMS_SCHEMA = imageEditV3SchemaRef('property', `${ENTITY}.default_params.value`)
const PROPERTIES = [
  catalogProperty('name', '名称', '滤镜在图片编辑器里的名字。', { kind: 'string' }),
  catalogProperty('operation_type', '滤镜种类', '创建 image_edit.layer_filter 时原样写进 operation_type。', { kind: 'enum', values: ['effect', 'adjustment'].map(value => ({ value, label: value })) }),
  catalogProperty('effect_id', '滤镜定义', '创建 image_edit.layer_filter 时原样写进 effect_id。', { kind: 'string' }),
  catalogProperty('description', '用途与参数', '滤镜的作用与参数含义。', { kind: 'string' }),
  catalogProperty('default_params', '默认参数', '中性默认参数；创建滤镜时以它为底改需要的键，整体写进 params。', { kind: 'json', schemaRef: DEFAULT_PARAMS_SCHEMA }),
]
const PROPERTY_VALUE: Record<string, (definition: FilterDefinition) => JsonValue> = {
  [`${ENTITY}.name`]: definition => definition.name,
  [`${ENTITY}.operation_type`]: definition => definition.operationType,
  [`${ENTITY}.effect_id`]: definition => definition.effectId,
  [`${ENTITY}.description`]: definition => definition.description,
  [`${ENTITY}.default_params`]: definition => definition.defaultParams,
}
const revisions = () => ({ image_edit: getImageEditDocumentCatalogRevisionV3() })

class FilterCatalogProvider {
  readonly entityType = ENTITY
  async listEntities(request: { cursor?: string; limit: number }) {
    const refs = definitions().map(definition => ({ kind: ENTITY, id: definition.id }))
    const start = Math.max(0, Number(request.cursor) || 0)
    return { refs: refs.slice(start, start + request.limit), nextCursor: start + request.limit < refs.length ? String(start + request.limit) : null, revisions: revisions() }
  }
  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    const all = definitions()
    const definition = all.find(item => item.id === ref.id)
    if (!definition) throw new Error(`NOT_FOUND：没有滤镜 ${ref.id}，可用：${all.map(item => item.id).join('、')}。`)
    const ids = request.propertyIds ?? Object.keys(PROPERTY_VALUE)
    return { ref, entityType: ENTITY, revisions: revisions(), capturedAt: new Date().toISOString(),
      properties: Object.fromEntries(ids.filter(id => PROPERTY_VALUE[id]).map(id => [id, PROPERTY_VALUE[id](definition)])) }
  }
  async getPropertyAvailability(_ref: ApplicationRef, propertyIds: string[]) {
    return propertyIds.map(propertyId => ({ propertyId, readable: true, writable: false, reasons: [READ_ONLY], requiredPermissions: ['image_edit:read'], revisions: revisions() }))
  }
  async getCollectionAvailability(parent: ApplicationRef) {
    const open = unrestrictedCollectionAvailability(ENTITY, parent, revisions())
    const closed = { ...open.create, available: false, reasons: [READ_ONLY] }
    return { ...open, create: closed, remove: closed }
  }
}

export function imageEditFilterCatalogRegistrationV3(): ApplicationEntityRegistration {
  return { entity: { id: ENTITY, domain: 'image_edit', version: 1, title: '可用滤镜目录',
    description: '图片图层可加的全部滤镜（模糊、发光、马赛克、全能调色、曝光、曲线、色温色调、HSL 等）及默认参数。给图层加滤镜：在图层或图层组下创建 image_edit.layer_filter，operation_type、effect_id 照这里填，params 以 default_params 为底。',
    refKind: ENTITY, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: ['image_edit'],
    queryCapabilityIds: ['read_application_entity'], schemaRef: imageEditV3SchemaRef('entity', ENTITY), writeExclusion: { reason: READ_ONLY }, omitFromDefaultSnapshot: true },
  properties: PROPERTIES, provider: new FilterCatalogProvider(),
  schemaDocuments: [{ ref: DEFAULT_PARAMS_SCHEMA, value: { type: 'object', description: '按 effect_id 的滤镜参数；共享效果的字段与范围见 image_edit.layer.params 的定义。' } }] }
}
