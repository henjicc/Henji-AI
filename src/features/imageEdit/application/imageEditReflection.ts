import { imageEditLayerFilterRegistrationV3 } from '../v3/application/imageEditLayerFilterEntityV3'
import { imageEditLayerMovesSchemaV3 } from '../v3/application/imageEditWorkflowFields'
import { imageEditNamedRegionsSchemaV3 } from '@/core/imageEdit/v3/namedRegions'
import { imageEditHistoryRowsSchemaV3 } from '../v3/application/imageEditHistoryFields'
import { imageEditMaskAttachmentSchemaV3, imageEditLayerFiltersSchemaV3 } from '@/core/imageEdit/v3/layerModel/semantics'
import { imageColorGradeJsonSchema } from '@/core/imaging/adjustments/schema'
import { z } from 'zod'
import { listImagingEffects } from '@/core/imaging/effects/registry'
import { imageEditSelectionRegistrationV3 } from '../v3/application/imageEditSelectionEntityV3'
import {
  unrestrictedCollectionAvailability,
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationEntitySnapshot,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'

import { iterateImageEditPreviewReferences, readImageEditPreview } from './imageEditSessionRegistry'
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
import { imageEditV3DocumentRef } from '../v3/application/imageEditDocumentRefs'

export const IMAGE_EDIT_ENTITY_TYPES = {
  preview: 'image_edit.preview',
  document: 'image_edit.document',
  layer: 'image_edit.layer',
  group: IMAGE_EDIT_V3_ENTITY_TYPES.group,
  mask: IMAGE_EDIT_V3_ENTITY_TYPES.mask,
  resource: IMAGE_EDIT_V3_ENTITY_TYPES.resource,
} as const

type ImageEditEntityType = typeof IMAGE_EDIT_ENTITY_TYPES[keyof typeof IMAGE_EDIT_ENTITY_TYPES]
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
 * 写法对齐 `assetReflection.ts`。预览属性只读；V3 文档几何和图层属性由相应写入器维护。
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

const properties: Record<ImageEditEntityType, ApplicationPropertyDescriptor[]> = {
  [IMAGE_EDIT_ENTITY_TYPES.preview]: [
    property(IMAGE_EDIT_ENTITY_TYPES.preview, 'source_ref', '来源引用', { kind: 'ref', refKinds: [...IMAGE_EDIT_SOURCE_REF_KINDS] }, '来源图片在预览创建时固定。'),
    property(IMAGE_EDIT_ENTITY_TYPES.preview, 'document_ref', '文档引用', { kind: 'ref', refKinds: [IMAGE_EDIT_ENTITY_TYPES.document] }, '文档与预览一一对应，由预览创建时确定。'),
    property(IMAGE_EDIT_ENTITY_TYPES.preview, 'width', '宽度', { kind: 'integer', hardRange: { min: 1 } }, '由来源图片实际尺寸读出。'),
    property(IMAGE_EDIT_ENTITY_TYPES.preview, 'height', '高度', { kind: 'integer', hardRange: { min: 1 } }, '由来源图片实际尺寸读出。'),
  ],
  [IMAGE_EDIT_ENTITY_TYPES.document]: IMAGE_EDIT_V3_PROPERTIES['image_edit.document'],
  [IMAGE_EDIT_ENTITY_TYPES.layer]: IMAGE_EDIT_V3_PROPERTIES['image_edit.layer'],
  [IMAGE_EDIT_ENTITY_TYPES.group]: IMAGE_EDIT_V3_PROPERTIES['image_edit.group'],
  [IMAGE_EDIT_ENTITY_TYPES.mask]: IMAGE_EDIT_V3_PROPERTIES['image_edit.mask'],
  [IMAGE_EDIT_ENTITY_TYPES.resource]: IMAGE_EDIT_V3_PROPERTIES['image_edit.resource'],
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

class ImageEditPreviewReflectionProvider implements ApplicationEntityProvider {
  readonly entityType = IMAGE_EDIT_ENTITY_TYPES.preview
  async listEntities(request: { cursor?: string; limit: number }) {
    const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
    const refs: ApplicationRef[] = []
    let index = 0; let revision = 0
    for (const preview of iterateImageEditPreviewReferences()) {
      if (index >= offset && refs.length < request.limit) refs.push({ kind: this.entityType, id: preview.previewRef })
      revision = Math.max(revision, preview.revision); index += 1
    }
    return { refs, nextCursor: offset + refs.length < index ? String(offset + refs.length) : null, revisions: { image_edit: revision } }
  }
  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }): Promise<ApplicationEntitySnapshot> {
    const preview = readImageEditPreview(ref.id)
    if (!preview || ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    const values = { 'image_edit.preview.source_ref': sourceRef(preview.sourceRef),
      'image_edit.preview.document_ref': imageEditV3DocumentRef(preview.document.id),
      'image_edit.preview.width': preview.width, 'image_edit.preview.height': preview.height }
    return { ref, entityType: this.entityType, revisions: { image_edit: preview.revision },
      properties: request.propertyIds ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds?.includes(id))) : values,
      capturedAt: new Date().toISOString() }
  }
  async getCollectionAvailability(parent: ApplicationRef) {
    return unrestrictedCollectionAvailability(this.entityType, parent, { image_edit: 0 })
  }
  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    const snapshot = await this.readEntity(ref, {})
    return propertyIds.map(propertyId => {
      const descriptor = properties[this.entityType].find(item => item.id === propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return { propertyId, readable: true, writable: false, reasons: [descriptor.readOnlyReason ?? '预览由创建能力维护。'], requiredPermissions: descriptor.requiredPermissions.read, revisions: snapshot.revisions }
    })
  }
}

const META: Record<ImageEditEntityType, { title: string; parents: ImageEditEntityType[] }> = {
  [IMAGE_EDIT_ENTITY_TYPES.preview]: { title: '图片编辑预览', parents: [] },
  [IMAGE_EDIT_ENTITY_TYPES.document]: { title: '图片编辑文档', parents: [] },
  [IMAGE_EDIT_ENTITY_TYPES.layer]: { title: '图片编辑层', parents: [IMAGE_EDIT_ENTITY_TYPES.document] },
  [IMAGE_EDIT_ENTITY_TYPES.group]: { title: '图片编辑图层组', parents: [IMAGE_EDIT_ENTITY_TYPES.document, IMAGE_EDIT_ENTITY_TYPES.group] },
  [IMAGE_EDIT_ENTITY_TYPES.mask]: { title: '图片编辑蒙版', parents: [IMAGE_EDIT_ENTITY_TYPES.layer, IMAGE_EDIT_ENTITY_TYPES.group] },
  [IMAGE_EDIT_ENTITY_TYPES.resource]: { title: '图片编辑资源', parents: [IMAGE_EDIT_ENTITY_TYPES.document] },
}

export function createImageEditReflectionRegistrations(): ApplicationEntityRegistration[] {
  return [...(Object.values(IMAGE_EDIT_ENTITY_TYPES) as ImageEditEntityType[]).map((entityType): ApplicationEntityRegistration => ({
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
      ...(entityType === IMAGE_EDIT_ENTITY_TYPES.preview || entityType === IMAGE_EDIT_ENTITY_TYPES.resource
        ? { writeExclusion: { reason: entityType === IMAGE_EDIT_ENTITY_TYPES.preview
          ? '图片编辑预览是不可变结果引用，由预览创建能力维护。'
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
    provider: entityType === IMAGE_EDIT_ENTITY_TYPES.preview ? new ImageEditPreviewReflectionProvider() : new ImageEditV3ReflectionProvider(entityType as ImageEditV3ReflectedEntityType),
    schemaDocuments: [...(entityType === IMAGE_EDIT_ENTITY_TYPES.layer || entityType === IMAGE_EDIT_ENTITY_TYPES.group ? [
      { ref: imageEditV3SchemaRef('property', `${entityType}.mask_attachment.value`), value: z.toJSONSchema(imageEditMaskAttachmentSchemaV3, { io: 'input' }) as JsonValue },
      { ref: imageEditV3SchemaRef('property', `${entityType}.filters.value`), value: z.toJSONSchema(imageEditLayerFiltersSchemaV3, { io: 'input' }) as JsonValue },
    ] : []), ...(entityType === IMAGE_EDIT_ENTITY_TYPES.layer ? [{
      ref: IMAGE_EDIT_V3_PARAMS_SCHEMA_REF,
      value: { type: 'object', description: '按 definition_id 选择对应字段定义；曲线为百分比控制点，LUT 为稳定资源引用。gaussian_blur 使用完整画面高度比例、方向与边缘处理；其他效果沿各自操作参数。', $defs: { color_grade: JSON.parse(JSON.stringify(imageColorGradeJsonSchema())) as JsonValue, ...Object.fromEntries(listImagingEffects().filter(effect => effect.hosts.includes('image')).map(effect => [effect.id, z.toJSONSchema(effect.parameterSchema, { io: 'input' }) as JsonValue])) } },
    }] : entityType === IMAGE_EDIT_ENTITY_TYPES.document ? [{
      ref: imageEditV3SchemaRef('property', 'image_edit.document.named_regions.value'),
      value: z.toJSONSchema(imageEditNamedRegionsSchemaV3, { io: 'input' }) as JsonValue,
    }, {
      ref: imageEditV3SchemaRef('property', 'image_edit.document.layer_order.value'),
      value: z.toJSONSchema(imageEditLayerMovesSchemaV3, { io: 'input' }) as JsonValue,
    }, {
      ref: imageEditV3SchemaRef('property', 'image_edit.document.history_entries.value'),
      value: z.toJSONSchema(imageEditHistoryRowsSchemaV3, { io: 'input' }) as JsonValue,
    }, {
      ref: imageEditV3SchemaRef('property', 'image_edit.document.color_mode.value'),
      value: { type: 'object', description: 'V3 文档的工作色域、位深、传递函数与 HDR 元数据。' },
    }] : entityType === IMAGE_EDIT_ENTITY_TYPES.resource ? [{
      ref: imageEditV3SchemaRef('property', 'image_edit.resource.roles.value'),
      value: { type: 'array', items: { type: 'string' } },
    }] : [])],
  })), imageEditSelectionRegistrationV3(), imageEditLayerFilterRegistrationV3()]
}
