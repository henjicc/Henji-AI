import {
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationEntitySnapshot,
  type ApplicationCollectionAvailability,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
  type JsonValue,
  unrestrictedCollectionAvailability,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import { listImageEditPreviews, readImageEditPreview, type ImageEditPreviewSnapshot } from './imageEditSessionRegistry'
import {
  IMAGE_EDIT_V3_ENTITY_TYPES,
  IMAGE_EDIT_V3_PARAMS_SCHEMA_REF,
  imageEditV3SchemaRef,
} from '../v3/application/imageEditV3Fields'
import {
  IMAGE_EDIT_V3_PROPERTIES,
  ImageEditV3ReflectionProvider,
  type ImageEditV3ReflectedEntityType,
} from '../v3/application/imageEditV3Reflection'
import { isImageEditV3Ref } from '../v3/application/imageEditLiveSessionRegistry'

export const IMAGE_EDIT_ENTITY_TYPES = {
  preview: 'image_edit.preview',
  document: 'image_edit.document',
  layer: 'image_edit.layer',
  group: IMAGE_EDIT_V3_ENTITY_TYPES.group,
  mask: IMAGE_EDIT_V3_ENTITY_TYPES.mask,
  resource: IMAGE_EDIT_V3_ENTITY_TYPES.resource,
} as const

type ImageEditEntityType = typeof IMAGE_EDIT_ENTITY_TYPES[keyof typeof IMAGE_EDIT_ENTITY_TYPES]
type ImageEditV2EntityType =
  | typeof IMAGE_EDIT_ENTITY_TYPES.preview
  | typeof IMAGE_EDIT_ENTITY_TYPES.document
  | typeof IMAGE_EDIT_ENTITY_TYPES.layer

const IMAGE_EDIT_SOURCE_REF_KINDS = [
  'asset',
  'generation.result',
  'image_edit.preview',
] as const

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function schemaRef(kind: 'entity' | 'property', id: string) {
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: digest(`${kind}:${id}`) } as const
}

/**
 * `readOnlyReason` 是**可选参数**，不传即为可写。
 *
 * 此前它被写死在函数体里，签名根本不接受这个参数——判定被结构固化，没人做过真正的决策。
 * 写法对齐 `assetReflection.ts`。当前图片编辑全部属性仍判定为只读，但理由改为逐条给出。
 */
function property(
  entityType: ImageEditEntityType,
  suffix: string,
  title: string,
  value: ApplicationPropertyDescriptor['value'],
  readOnlyReason?: string,
): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: `图片编辑${title}。`,
    value,
    nullable: false,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['image_edit:read'], write: readOnlyReason ? [] : ['image_edit:write'] },
    revisionScopes: ['image_edit'],
    schemaRef: schemaRef('property', id),
    ...(readOnlyReason ? { readOnlyReason } : {}),
  }
}

/**
 * 图片编辑预览是**不可变快照**：`createImageEditPreview(operations)` 由整组操作一次性构建文档，
 * 存成带 revision 的快照，服务层没有「往已有预览里改一层」的入口。要调整编辑内容，应调
 * `create_image_edit_preview` 传完整 sourceRef 与 operations 列表生成新预览。
 */
const IMMUTABLE_PREVIEW = '图片编辑预览是不可变快照，改动请用完整 operations 列表生成新预览。'

const properties: Record<ImageEditEntityType, ApplicationPropertyDescriptor[]> = {
  [IMAGE_EDIT_ENTITY_TYPES.preview]: [
    property(IMAGE_EDIT_ENTITY_TYPES.preview, 'source_ref', '来源引用', { kind: 'ref', refKinds: [...IMAGE_EDIT_SOURCE_REF_KINDS] }, '来源图片在预览创建时固定。'),
    property(IMAGE_EDIT_ENTITY_TYPES.preview, 'document_ref', '文档引用', { kind: 'ref', refKinds: [IMAGE_EDIT_ENTITY_TYPES.document] }, '文档与预览一一对应，由预览创建时确定。'),
    property(IMAGE_EDIT_ENTITY_TYPES.preview, 'width', '宽度', { kind: 'integer', hardRange: { min: 1 } }, '由来源图片实际尺寸读出。'),
    property(IMAGE_EDIT_ENTITY_TYPES.preview, 'height', '高度', { kind: 'integer', hardRange: { min: 1 } }, '由来源图片实际尺寸读出。'),
  ],
  [IMAGE_EDIT_ENTITY_TYPES.document]: [
    { ...property(IMAGE_EDIT_ENTITY_TYPES.document, 'preview_ref', '预览引用', { kind: 'ref', refKinds: [IMAGE_EDIT_ENTITY_TYPES.preview] }, '旧版文档所属预览不可变更；V3 实时文档没有旧版预览引用。'), nullable: true },
    property(IMAGE_EDIT_ENTITY_TYPES.document, 'layer_refs', '编辑层引用', { kind: 'ref_list', refKinds: [IMAGE_EDIT_ENTITY_TYPES.layer, IMAGE_EDIT_ENTITY_TYPES.group], maxItems: 512 }, IMMUTABLE_PREVIEW),
    property(IMAGE_EDIT_ENTITY_TYPES.document, 'version', '文档版本', { kind: 'integer', hardRange: { min: 1 } }, '版本号由预览生成链路递增。'),
    ...IMAGE_EDIT_V3_PROPERTIES['image_edit.document'],
  ],
  [IMAGE_EDIT_ENTITY_TYPES.layer]: [
    property(IMAGE_EDIT_ENTITY_TYPES.layer, 'operation_id', '操作类型', { kind: 'string', maxLength: 120 }, '操作类型在图层生成时确定，改类型等于换一个图层。'),
    property(IMAGE_EDIT_ENTITY_TYPES.layer, 'enabled', '启用状态', { kind: 'boolean' }, IMMUTABLE_PREVIEW),
    ...IMAGE_EDIT_V3_PROPERTIES['image_edit.layer'],
  ],
  [IMAGE_EDIT_ENTITY_TYPES.group]: IMAGE_EDIT_V3_PROPERTIES['image_edit.group'],
  [IMAGE_EDIT_ENTITY_TYPES.mask]: IMAGE_EDIT_V3_PROPERTIES['image_edit.mask'],
  [IMAGE_EDIT_ENTITY_TYPES.resource]: IMAGE_EDIT_V3_PROPERTIES['image_edit.resource'],
}

function layerRef(previewRef: string, layerId: string): ApplicationRef {
  return { kind: IMAGE_EDIT_ENTITY_TYPES.layer, id: `${encodeURIComponent(previewRef)}:${encodeURIComponent(layerId)}` }
}

function splitLayerRef(ref: ApplicationRef): { previewRef: string; layerId: string } {
  if (ref.kind !== IMAGE_EDIT_ENTITY_TYPES.layer) throw new Error('NOT_FOUND')
  const separator = ref.id.indexOf(':')
  if (separator < 1) throw new Error('NOT_FOUND')
  return {
    previewRef: decodeURIComponent(ref.id.slice(0, separator)),
    layerId: decodeURIComponent(ref.id.slice(separator + 1)),
  }
}

function previewRef(kind: typeof IMAGE_EDIT_ENTITY_TYPES.preview | typeof IMAGE_EDIT_ENTITY_TYPES.document, preview: ImageEditPreviewSnapshot): ApplicationRef {
  return { kind, id: preview.previewRef }
}

function sourceRef(value: string): ApplicationRef {
  const separator = value.indexOf(':')
  if (separator < 1 || separator === value.length - 1) throw new Error('INVALID_SOURCE_REF')
  const kind = value.slice(0, separator)
  if (!(IMAGE_EDIT_SOURCE_REF_KINDS as readonly string[]).includes(kind)) {
    throw new Error('INVALID_SOURCE_REF')
  }
  return { kind, id: value.slice(separator + 1) }
}

class ImageEditV2ReflectionProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: ImageEditV2EntityType) {}

  async listEntities(request: { cursor?: string; limit: number }) {
    const previews = listImageEditPreviews()
    const refs = previews.flatMap((preview) => {
      if (this.entityType === IMAGE_EDIT_ENTITY_TYPES.layer) {
        return preview.document.operations.map((operation) => layerRef(preview.previewRef, operation.id))
      }
      return [previewRef(this.entityType, preview)]
    })
    const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
    const page = refs.slice(offset, offset + request.limit)
    return {
      refs: page,
      nextCursor: offset + page.length < refs.length ? String(offset + page.length) : null,
      revisions: { image_edit: Math.max(0, ...previews.map((preview) => preview.revision)) },
    }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    const { preview, properties: values } = this.readProperties(ref)
    const selected = request.propertyIds
      ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds?.includes(id)))
      : values
    return {
      ref,
      entityType: this.entityType,
      revisions: { image_edit: preview.revision },
      properties: selected,
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    const { preview } = this.readProperties(ref)
    const descriptors = new Map(properties[this.entityType].map((item) => [item.id, item]))
    return propertyIds.map((propertyId) => {
      const descriptor = descriptors.get(propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return {
        propertyId,
        readable: true,
        writable: false,
        reasons: [descriptor.readOnlyReason ?? '只读'],
        requiredPermissions: ['image_edit:read'],
        revisions: { image_edit: preview.revision },
      }
    })
  }

  async getCollectionAvailability(parent: ApplicationRef) {
    return unrestrictedCollectionAvailability(this.entityType, parent, { image_edit: 0 }, ['image_edit:write'])
  }

  private readProperties(ref: ApplicationRef): { preview: ImageEditPreviewSnapshot; properties: Record<string, JsonValue> } {
    const layerIdentity = this.entityType === IMAGE_EDIT_ENTITY_TYPES.layer ? splitLayerRef(ref) : null
    if (!layerIdentity && ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    const preview = readImageEditPreview(layerIdentity?.previewRef ?? ref.id)
    if (!preview) throw new Error('NOT_FOUND')
    if (this.entityType === IMAGE_EDIT_ENTITY_TYPES.preview) {
      return { preview, properties: {
        'image_edit.preview.source_ref': sourceRef(preview.sourceRef),
        'image_edit.preview.document_ref': previewRef(IMAGE_EDIT_ENTITY_TYPES.document, preview),
        'image_edit.preview.width': preview.width,
        'image_edit.preview.height': preview.height,
      } }
    }
    if (this.entityType === IMAGE_EDIT_ENTITY_TYPES.document) {
      return { preview, properties: {
        'image_edit.document.preview_ref': previewRef(IMAGE_EDIT_ENTITY_TYPES.preview, preview),
        'image_edit.document.layer_refs': preview.document.operations.map((operation) => layerRef(preview.previewRef, operation.id)),
        'image_edit.document.version': preview.document.version,
        'image_edit.document.revision': preview.revision,
        'image_edit.document.width': preview.width,
        'image_edit.document.height': preview.height,
        'image_edit.document.color_mode': null,
        'image_edit.document.root_refs': preview.document.operations.map((operation) => layerRef(preview.previewRef, operation.id)),
      } }
    }
    const operation = preview.document.operations.find((item) => item.id === layerIdentity?.layerId)
    if (!operation) throw new Error('NOT_FOUND')
    return { preview, properties: {
      'image_edit.layer.document_ref': previewRef(IMAGE_EDIT_ENTITY_TYPES.document, preview),
      'image_edit.layer.operation_id': operation.operationId,
      'image_edit.layer.enabled': operation.enabled,
      'image_edit.layer.parent_ref': previewRef(IMAGE_EDIT_ENTITY_TYPES.document, preview),
      'image_edit.layer.index': preview.document.operations.findIndex((item) => item.id === operation.id),
      'image_edit.layer.name': operation.operationId,
      'image_edit.layer.visible': operation.enabled,
      'image_edit.layer.locked': false,
      'image_edit.layer.opacity': 1,
      'image_edit.layer.blend_mode': 'normal',
      'image_edit.layer.mask_ref': null,
      'image_edit.layer.type': 'effect',
      'image_edit.layer.definition_id': operation.operationId,
      'image_edit.layer.params': JSON.parse(JSON.stringify(operation.params)) as JsonValue,
    } }
  }
}

function unavailableCollection(
  entityType: string,
  parent: ApplicationRef,
  revisions: Record<string, number>,
): ApplicationCollectionAvailability {
  const base = unrestrictedCollectionAvailability(entityType, parent, revisions, ['image_edit:write'])
  const reason = '旧版图片编辑预览是不可变快照；请先在 V3 编辑器中打开文档。'
  const block = {
    kind: 'state' as const,
    requirementId: 'image_edit.v3.live_session',
    affectedEntityTypes: ['image_edit.document'],
    revisionScopes: ['image_edit'],
  }
  return {
    ...base,
    create: { ...base.create, available: false, reasons: [reason], blocks: [block] },
    remove: { ...base.remove, available: false, reasons: [reason], blocks: [block] },
  }
}

class CombinedImageEditReflectionProvider implements ApplicationEntityProvider {
  private readonly v2: ImageEditV2ReflectionProvider | null
  private readonly v3: ImageEditV3ReflectionProvider | null

  constructor(readonly entityType: ImageEditEntityType) {
    this.v2 = entityType === IMAGE_EDIT_ENTITY_TYPES.preview
      || entityType === IMAGE_EDIT_ENTITY_TYPES.document
      || entityType === IMAGE_EDIT_ENTITY_TYPES.layer
      ? new ImageEditV2ReflectionProvider(entityType)
      : null
    this.v3 = entityType === IMAGE_EDIT_ENTITY_TYPES.preview
      ? null
      : new ImageEditV3ReflectionProvider(entityType as ImageEditV3ReflectedEntityType)
  }

  async listEntities(request: { cursor?: string; limit: number }) {
    const [legacy, live] = await Promise.all([
      this.v2?.listEntities({ limit: 100_000 }) ?? Promise.resolve({ refs: [], nextCursor: null, revisions: { image_edit: 0 } }),
      this.v3?.listEntities({ limit: 100_000 }) ?? Promise.resolve({ refs: [], nextCursor: null, revisions: { image_edit: 0 } }),
    ])
    const refs = [...legacy.refs, ...live.refs]
    const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
    const page = refs.slice(offset, offset + request.limit)
    return {
      refs: page,
      nextCursor: offset + page.length < refs.length ? String(offset + page.length) : null,
      revisions: { image_edit: Math.max(legacy.revisions.image_edit ?? 0, live.revisions.image_edit ?? 0) },
    }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }): Promise<ApplicationEntitySnapshot> {
    const provider = isImageEditV3Ref(ref) ? this.v3 : this.v2
    if (!provider) throw new Error('NOT_FOUND')
    const snapshot = await provider.readEntity(ref, isImageEditV3Ref(ref) ? {} : request)
    if (!isImageEditV3Ref(ref)) return snapshot
    const values = { ...snapshot.properties }
    if (this.entityType === IMAGE_EDIT_ENTITY_TYPES.document) {
      values['image_edit.document.preview_ref'] = null
      values['image_edit.document.layer_refs'] = values['image_edit.document.root_refs'] ?? []
      values['image_edit.document.version'] = 3
    } else if (this.entityType === IMAGE_EDIT_ENTITY_TYPES.layer) {
      values['image_edit.layer.operation_id'] = values['image_edit.layer.definition_id']
        ?? values['image_edit.layer.type']
        ?? 'layer'
      values['image_edit.layer.enabled'] = values['image_edit.layer.visible'] ?? true
    }
    return { ...snapshot, properties: request.propertyIds
      ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds?.includes(id)))
      : values }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    const provider = isImageEditV3Ref(ref) ? this.v3 : this.v2
    if (!provider) throw new Error('NOT_FOUND')
    if (!isImageEditV3Ref(ref)) return provider.getPropertyAvailability(ref, propertyIds)
    const v3Ids = new Set(IMAGE_EDIT_V3_PROPERTIES[this.entityType as ImageEditV3ReflectedEntityType]?.map((item) => item.id) ?? [])
    const nativeIds = propertyIds.filter((id) => v3Ids.has(id))
    const compatibilityIds = propertyIds.filter((id) => !v3Ids.has(id))
    const available = nativeIds.length > 0 ? await provider.getPropertyAvailability(ref, nativeIds) : []
    return [...available, ...compatibilityIds.map((propertyId) => ({
      propertyId,
      readable: true,
      writable: false,
      reasons: ['这是旧版兼容投影，只能读取。'],
      requiredPermissions: ['image_edit:read'],
      revisions: available[0]?.revisions ?? { image_edit: 0 },
    }))]
  }

  async getCollectionAvailability(parent: ApplicationRef) {
    if (isImageEditV3Ref(parent) && this.v3) return this.v3.getCollectionAvailability(parent)
    const revisions = this.v2
      ? (await this.v2.readEntity(parent, { propertyIds: [] })).revisions
      : { image_edit: 0 }
    return unavailableCollection(this.entityType, parent, revisions)
  }
}

const META: Record<ImageEditEntityType, { title: string; parents: ImageEditEntityType[] }> = {
  [IMAGE_EDIT_ENTITY_TYPES.preview]: { title: '图片编辑预览', parents: [] },
  [IMAGE_EDIT_ENTITY_TYPES.document]: { title: '图片编辑文档', parents: [IMAGE_EDIT_ENTITY_TYPES.preview] },
  [IMAGE_EDIT_ENTITY_TYPES.layer]: { title: '图片编辑层', parents: [IMAGE_EDIT_ENTITY_TYPES.document] },
  [IMAGE_EDIT_ENTITY_TYPES.group]: { title: '图片编辑图层组', parents: [IMAGE_EDIT_ENTITY_TYPES.document, IMAGE_EDIT_ENTITY_TYPES.group] },
  [IMAGE_EDIT_ENTITY_TYPES.mask]: { title: '图片编辑蒙版', parents: [IMAGE_EDIT_ENTITY_TYPES.layer, IMAGE_EDIT_ENTITY_TYPES.group] },
  [IMAGE_EDIT_ENTITY_TYPES.resource]: { title: '图片编辑资源', parents: [IMAGE_EDIT_ENTITY_TYPES.document] },
}

export function createImageEditReflectionRegistrations(): ApplicationEntityRegistration[] {
  return (Object.values(IMAGE_EDIT_ENTITY_TYPES) as ImageEditEntityType[]).map((entityType) => ({
    entity: {
      id: entityType,
      domain: 'image_edit',
      version: 1,
      title: META[entityType].title,
      description: '由正式图片编辑预览事务维护的稳定实体。',
      refKind: entityType,
      dataClass: 'C1',
      exposures: ['ui', 'assistant', 'local_adapter'],
      parentTypes: META[entityType].parents,
      revisionScopes: ['image_edit'],
      queryCapabilityIds: [entityType === IMAGE_EDIT_ENTITY_TYPES.preview
        ? 'create_image_edit_preview'
        : 'read_application_entity'],
      schemaRef: schemaRef('entity', entityType),
      ...(entityType === IMAGE_EDIT_ENTITY_TYPES.preview || entityType === IMAGE_EDIT_ENTITY_TYPES.document
        || entityType === IMAGE_EDIT_ENTITY_TYPES.resource
        ? { writeExclusion: { reason: entityType === IMAGE_EDIT_ENTITY_TYPES.preview
          ? '旧版图片编辑预览是不可变快照，由预览创建能力维护。'
          : entityType === IMAGE_EDIT_ENTITY_TYPES.document
            ? '文档元数据由 V3 命令总线维护；图层增删通过子实体集合写入。'
            : '权威资源由图片资源库、画笔和蒙版工具维护，助手只读取引用关系。' } }
        : {}),
      ...(entityType === IMAGE_EDIT_ENTITY_TYPES.layer ? {
        collectionWrite: {
          creatable: true,
          removable: true,
          requiredPropertyIds: [
            'image_edit.layer.name',
            'image_edit.layer.type',
            'image_edit.layer.definition_id',
            'image_edit.layer.params',
          ],
          maxItemsPerChange: 32,
        },
      } : {}),
      ...(entityType === IMAGE_EDIT_ENTITY_TYPES.group ? {
        collectionWrite: {
          creatable: true,
          removable: true,
          requiredPropertyIds: ['image_edit.group.name'],
          maxItemsPerChange: 32,
        },
      } : {}),
    },
    properties: properties[entityType],
    provider: new CombinedImageEditReflectionProvider(entityType),
    schemaDocuments: entityType === IMAGE_EDIT_ENTITY_TYPES.layer ? [{
      ref: IMAGE_EDIT_V3_PARAMS_SCHEMA_REF,
      value: { type: 'object', description: '参数由图片编辑操作注册表按 operation_id 校验。' },
    }] : entityType === IMAGE_EDIT_ENTITY_TYPES.document ? [{
      ref: imageEditV3SchemaRef('property', 'image_edit.document.color_mode.value'),
      value: { type: 'object', description: 'V3 文档的工作色域、位深、传递函数与 HDR 元数据。' },
    }] : entityType === IMAGE_EDIT_ENTITY_TYPES.resource ? [{
      ref: imageEditV3SchemaRef('property', 'image_edit.resource.roles.value'),
      value: { type: 'array', items: { type: 'string' } },
    }] : [],
  }))
}
