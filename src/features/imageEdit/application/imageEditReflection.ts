import {
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
  type JsonValue,
  unrestrictedCollectionAvailability,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import { listImageEditPreviews, readImageEditPreview, type ImageEditPreviewSnapshot } from './imageEditSessionRegistry'

export const IMAGE_EDIT_ENTITY_TYPES = {
  session: 'image_edit.session',
  document: 'image_edit.document',
  layer: 'image_edit.layer',
} as const

type ImageEditEntityType = typeof IMAGE_EDIT_ENTITY_TYPES[keyof typeof IMAGE_EDIT_ENTITY_TYPES]

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
 * `create_image_edit_preview_from_ref` 传完整 operations 列表生成新预览。
 */
const IMMUTABLE_PREVIEW = '图片编辑预览是不可变快照，改动请用完整 operations 列表生成新预览。'

const IMAGE_EDIT_PARAMS_SCHEMA_REF = schemaRef('property', 'image_edit.layer.params.value')

const properties: Record<ImageEditEntityType, ApplicationPropertyDescriptor[]> = {
  [IMAGE_EDIT_ENTITY_TYPES.session]: [
    property(IMAGE_EDIT_ENTITY_TYPES.session, 'source_ref', '来源引用', { kind: 'string', maxLength: 500 }, '来源图片在会话创建时固定。'),
    property(IMAGE_EDIT_ENTITY_TYPES.session, 'document_ref', '文档引用', { kind: 'ref', refKinds: [IMAGE_EDIT_ENTITY_TYPES.document] }, '文档与会话一一对应，由预览创建时确定。'),
    property(IMAGE_EDIT_ENTITY_TYPES.session, 'width', '宽度', { kind: 'integer', hardRange: { min: 1 } }, '由来源图片实际尺寸读出。'),
    property(IMAGE_EDIT_ENTITY_TYPES.session, 'height', '高度', { kind: 'integer', hardRange: { min: 1 } }, '由来源图片实际尺寸读出。'),
  ],
  [IMAGE_EDIT_ENTITY_TYPES.document]: [
    property(IMAGE_EDIT_ENTITY_TYPES.document, 'session_ref', '会话引用', { kind: 'ref', refKinds: [IMAGE_EDIT_ENTITY_TYPES.session] }, '文档所属会话不可变更。'),
    property(IMAGE_EDIT_ENTITY_TYPES.document, 'layer_refs', '编辑层引用', { kind: 'ref_list', refKinds: [IMAGE_EDIT_ENTITY_TYPES.layer], maxItems: 128 }, IMMUTABLE_PREVIEW),
    property(IMAGE_EDIT_ENTITY_TYPES.document, 'version', '文档版本', { kind: 'integer', hardRange: { min: 1 } }, '版本号由预览生成链路递增。'),
  ],
  [IMAGE_EDIT_ENTITY_TYPES.layer]: [
    property(IMAGE_EDIT_ENTITY_TYPES.layer, 'document_ref', '文档引用', { kind: 'ref', refKinds: [IMAGE_EDIT_ENTITY_TYPES.document] }, '图层所属文档不可变更。'),
    property(IMAGE_EDIT_ENTITY_TYPES.layer, 'operation_id', '操作类型', { kind: 'string', maxLength: 120 }, '操作类型在图层生成时确定，改类型等于换一个图层。'),
    property(IMAGE_EDIT_ENTITY_TYPES.layer, 'enabled', '启用状态', { kind: 'boolean' }, IMMUTABLE_PREVIEW),
    property(IMAGE_EDIT_ENTITY_TYPES.layer, 'params', '受控参数', { kind: 'json', schemaRef: IMAGE_EDIT_PARAMS_SCHEMA_REF }, IMMUTABLE_PREVIEW),
  ],
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

function previewRef(kind: typeof IMAGE_EDIT_ENTITY_TYPES.session | typeof IMAGE_EDIT_ENTITY_TYPES.document, preview: ImageEditPreviewSnapshot): ApplicationRef {
  return { kind, id: preview.previewRef }
}

class ImageEditReflectionProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: ImageEditEntityType) {}

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
    if (this.entityType === IMAGE_EDIT_ENTITY_TYPES.session) {
      return { preview, properties: {
        'image_edit.session.source_ref': preview.sourceRef,
        'image_edit.session.document_ref': previewRef(IMAGE_EDIT_ENTITY_TYPES.document, preview),
        'image_edit.session.width': preview.width,
        'image_edit.session.height': preview.height,
      } }
    }
    if (this.entityType === IMAGE_EDIT_ENTITY_TYPES.document) {
      return { preview, properties: {
        'image_edit.document.session_ref': previewRef(IMAGE_EDIT_ENTITY_TYPES.session, preview),
        'image_edit.document.layer_refs': preview.document.operations.map((operation) => layerRef(preview.previewRef, operation.id)),
        'image_edit.document.version': preview.document.version,
      } }
    }
    const operation = preview.document.operations.find((item) => item.id === layerIdentity?.layerId)
    if (!operation) throw new Error('NOT_FOUND')
    return { preview, properties: {
      'image_edit.layer.document_ref': previewRef(IMAGE_EDIT_ENTITY_TYPES.document, preview),
      'image_edit.layer.operation_id': operation.operationId,
      'image_edit.layer.enabled': operation.enabled,
      'image_edit.layer.params': JSON.parse(JSON.stringify(operation.params)) as JsonValue,
    } }
  }
}

const META: Record<ImageEditEntityType, { title: string; parents: ImageEditEntityType[] }> = {
  [IMAGE_EDIT_ENTITY_TYPES.session]: { title: '图片编辑会话', parents: [] },
  [IMAGE_EDIT_ENTITY_TYPES.document]: { title: '图片编辑文档', parents: [IMAGE_EDIT_ENTITY_TYPES.session] },
  [IMAGE_EDIT_ENTITY_TYPES.layer]: { title: '图片编辑层', parents: [IMAGE_EDIT_ENTITY_TYPES.document] },
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
      queryCapabilityIds: ['create_image_edit_preview'],
      schemaRef: schemaRef('entity', entityType),
      writeExclusion: { reason: '图片编辑预览是不可变快照，改动请用完整 operations 列表生成新预览。' },
    },
    properties: properties[entityType],
    provider: new ImageEditReflectionProvider(entityType),
    schemaDocuments: entityType === IMAGE_EDIT_ENTITY_TYPES.layer ? [{
      ref: IMAGE_EDIT_PARAMS_SCHEMA_REF,
      value: { type: 'object', description: '参数由图片编辑操作注册表按 operation_id 校验。' },
    }] : [],
  }))
}
