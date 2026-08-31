import {
  fieldDescriptors,
  fieldReadValues,
  type ApplicationCollectionAvailability,
  type ApplicationEntityListRequest,
  type ApplicationEntityListResult,
  type ApplicationEntitySnapshot,
  type ApplicationPropertyAvailability,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
  type JsonValue,
  unrestrictedCollectionAvailability,
} from '@/core/application-control'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { collectImageEditMaskResourceIdsV3 } from '@/core/imageEdit/v3/layerTypes'

import {
  IMAGE_EDIT_V3_GROUP_FIELDS,
  IMAGE_EDIT_V3_LAYER_FIELDS,
  IMAGE_EDIT_V3_MASK_FIELDS,
  imageEditV3SchemaRef,
} from './imageEditV3Fields'
import {
  collectImageEditV3LiveLayers,
  findImageEditV3LiveLayer,
  getImageEditV3LiveRevision,
  imageEditV3DocumentRef,
  imageEditV3GroupRef,
  imageEditV3LayerRef,
  imageEditV3MaskRef,
  imageEditV3ResourceRef,
  listImageEditV3LiveSessions,
  requireImageEditV3LiveSession,
  splitImageEditV3DocumentRef,
  splitImageEditV3LayerRef,
  splitImageEditV3ResourceRef,
} from './imageEditLiveSessionRegistry'

export type ImageEditV3ReflectedEntityType =
  | 'image_edit.document'
  | 'image_edit.layer'
  | 'image_edit.group'
  | 'image_edit.mask'
  | 'image_edit.resource'

const READ_ONLY_DOCUMENT = '由当前打开的 V3 编辑器命令总线维护。'

function property(
  entityType: ImageEditV3ReflectedEntityType,
  suffix: string,
  title: string,
  value: ApplicationPropertyDescriptor['value'],
  nullable = false,
): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: `图片编辑 V3 ${title}。`,
    value,
    nullable,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['image_edit:read'], write: [] },
    revisionScopes: ['image_edit'],
    schemaRef: imageEditV3SchemaRef('property', id),
    readOnlyReason: READ_ONLY_DOCUMENT,
  }
}

export const IMAGE_EDIT_V3_DOCUMENT_PROPERTIES: ApplicationPropertyDescriptor[] = [
  property('image_edit.document', 'revision', '文档修订号', { kind: 'integer', hardRange: { min: 0 } }),
  property('image_edit.document', 'width', '画布宽度', { kind: 'integer', hardRange: { min: 1 } }),
  property('image_edit.document', 'height', '画布高度', { kind: 'integer', hardRange: { min: 1 } }),
  property('image_edit.document', 'color_mode', '色彩模式', {
    kind: 'json', schemaRef: imageEditV3SchemaRef('property', 'image_edit.document.color_mode.value'),
  }, true),
  property('image_edit.document', 'root_refs', '根图层', {
    kind: 'ref_list', refKinds: ['image_edit.layer', 'image_edit.group'], maxItems: 512,
  }),
]

export const IMAGE_EDIT_V3_RESOURCE_PROPERTIES: ApplicationPropertyDescriptor[] = [
  property('image_edit.resource', 'document_ref', '所属文档', {
    kind: 'ref', refKinds: ['image_edit.document'],
  }),
  property('image_edit.resource', 'resource_id', '内容寻址资源 ID', { kind: 'string', maxLength: 512 }),
  property('image_edit.resource', 'roles', '资源用途', {
    kind: 'json', schemaRef: imageEditV3SchemaRef('property', 'image_edit.resource.roles.value'),
  }),
  property('image_edit.resource', 'layer_refs', '引用图层', {
    kind: 'ref_list', refKinds: ['image_edit.layer', 'image_edit.group'], maxItems: 512,
  }),
]

export const IMAGE_EDIT_V3_PROPERTIES: Readonly<
  Record<ImageEditV3ReflectedEntityType, ApplicationPropertyDescriptor[]>
> = {
  'image_edit.document': IMAGE_EDIT_V3_DOCUMENT_PROPERTIES,
  'image_edit.layer': fieldDescriptors(IMAGE_EDIT_V3_LAYER_FIELDS),
  'image_edit.group': fieldDescriptors(IMAGE_EDIT_V3_GROUP_FIELDS),
  'image_edit.mask': fieldDescriptors(IMAGE_EDIT_V3_MASK_FIELDS),
  'image_edit.resource': IMAGE_EDIT_V3_RESOURCE_PROPERTIES,
}

interface ResourceUsage {
  resourceId: string
  roles: Set<string>
  layerIds: Set<string>
}

function collectResources(document: ImageEditDocumentV3): ResourceUsage[] {
  const byId = new Map<string, ResourceUsage>()
  const add = (resourceId: string, role: string, layerId: string): void => {
    const usage = byId.get(resourceId) ?? {
      resourceId,
      roles: new Set<string>(),
      layerIds: new Set<string>(),
    }
    usage.roles.add(role)
    usage.layerIds.add(layerId)
    byId.set(resourceId, usage)
  }
  for (const { layer } of collectImageEditV3LiveLayers(document)) {
    if (layer.mask) {
      for (const resourceId of collectImageEditMaskResourceIdsV3(layer.mask)) {
        add(resourceId, 'mask', layer.id)
      }
    }
    if (layer.type !== 'raster') continue
    if (layer.source.kind === 'resource') add(layer.source.resourceId, 'raster-source', layer.id)
    for (const resourceId of Object.values(layer.tiles)) add(resourceId, 'raster-tile', layer.id)
  }
  return [...byId.values()].sort((left, right) => left.resourceId.localeCompare(right.resourceId))
}

function refForLayer(documentId: string, layer: { id: string; type: string }): ApplicationRef {
  return layer.type === 'group'
    ? imageEditV3GroupRef(documentId, layer.id)
    : imageEditV3LayerRef(documentId, layer.id)
}

function paginate(refs: ApplicationRef[], request: ApplicationEntityListRequest): ApplicationEntityListResult {
  const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
  const page = refs.slice(offset, offset + request.limit)
  return {
    refs: page,
    nextCursor: offset + page.length < refs.length ? String(offset + page.length) : null,
    revisions: { image_edit: getImageEditV3LiveRevision() },
  }
}

function layerSource(ref: ApplicationRef, kind: 'image_edit.layer' | 'image_edit.group' | 'image_edit.mask') {
  const { documentId, layerId } = splitImageEditV3LayerRef(ref, kind)
  const session = requireImageEditV3LiveSession(documentId)
  const location = findImageEditV3LiveLayer(session.bus.getSnapshot().document, layerId)
  if (!location) throw new Error('NOT_FOUND')
  if (kind === 'image_edit.group' && location.layer.type !== 'group') throw new Error('NOT_FOUND')
  if (kind === 'image_edit.layer' && location.layer.type === 'group') throw new Error('NOT_FOUND')
  if (kind === 'image_edit.mask' && !location.layer.mask) throw new Error('NOT_FOUND')
  return { documentId, location }
}

function selectProperties(
  values: Record<string, JsonValue>,
  propertyIds?: string[],
): Record<string, JsonValue> {
  if (!propertyIds) return values
  return Object.fromEntries(Object.entries(values).filter(([id]) => propertyIds.includes(id)))
}

function layerAvailability(
  ref: ApplicationRef,
  entityType: 'image_edit.layer' | 'image_edit.group' | 'image_edit.mask',
  propertyIds: string[],
): ApplicationPropertyAvailability[] {
  const source = layerSource(ref, entityType)
  const descriptors = new Map(IMAGE_EDIT_V3_PROPERTIES[entityType].map((item) => [item.id, item]))
  const ancestorLocked = source.location.ancestors.some((ancestor) => ancestor.locked)
  const layerLocked = source.location.layer.locked
  const revisions = { image_edit: getImageEditV3LiveRevision() }
  return propertyIds.map((propertyId) => {
    const descriptor = descriptors.get(propertyId)
    if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
    const reasons: string[] = []
    let writable = !descriptor.readOnlyReason
    if (writable && ancestorLocked) {
      writable = false
      reasons.push('图层所在的父组已锁定。')
    }
    if (writable && entityType !== 'image_edit.mask' && layerLocked && !propertyId.endsWith('.locked')) {
      writable = false
      reasons.push('图层已锁定；请先把 locked 设为 false。')
    }
    if (writable && propertyId === 'image_edit.layer.params') {
      const layer = source.location.layer
      if ((layer.type !== 'effect' && layer.type !== 'adjustment') || !layer.renderable) {
        writable = false
        reasons.push('只有可渲染的效果或调整图层能修改 params。')
      }
    }
    if (writable && entityType === 'image_edit.mask' && layerLocked) {
      writable = false
      reasons.push('图层已锁定；请先解锁图层。')
    }
    if (!writable && reasons.length === 0) reasons.push(descriptor.readOnlyReason ?? '当前状态不可写。')
    return {
      propertyId,
      readable: true,
      writable,
      reasons,
      requiredPermissions: writable ? descriptor.requiredPermissions.write : descriptor.requiredPermissions.read,
      revisions,
    }
  })
}

export class ImageEditV3ReflectionProvider {
  constructor(readonly entityType: ImageEditV3ReflectedEntityType) {}

  async listEntities(request: ApplicationEntityListRequest): Promise<ApplicationEntityListResult> {
    const refs = listImageEditV3LiveSessions().flatMap(({ documentId, bus }) => {
      const document = bus.getSnapshot().document
      if (this.entityType === 'image_edit.document') return [imageEditV3DocumentRef(documentId)]
      const locations = collectImageEditV3LiveLayers(document)
      if (this.entityType === 'image_edit.layer') {
        return locations.filter(({ layer }) => layer.type !== 'group')
          .map(({ layer }) => imageEditV3LayerRef(documentId, layer.id))
      }
      if (this.entityType === 'image_edit.group') {
        return locations.filter(({ layer }) => layer.type === 'group')
          .map(({ layer }) => imageEditV3GroupRef(documentId, layer.id))
      }
      if (this.entityType === 'image_edit.mask') {
        return locations.filter(({ layer }) => layer.mask)
          .map(({ layer }) => imageEditV3MaskRef(documentId, layer.id))
      }
      return collectResources(document)
        .map(({ resourceId }) => imageEditV3ResourceRef(documentId, resourceId))
    })
    return paginate(refs, request)
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }): Promise<ApplicationEntitySnapshot> {
    const revision = getImageEditV3LiveRevision()
    let values: Record<string, JsonValue>
    if (this.entityType === 'image_edit.document') {
      const { documentId } = splitImageEditV3DocumentRef(ref)
      const document = requireImageEditV3LiveSession(documentId).bus.getSnapshot().document
      values = {
        'image_edit.document.revision': document.revision,
        'image_edit.document.width': document.geometry.width,
        'image_edit.document.height': document.geometry.height,
        'image_edit.document.color_mode': structuredClone(document.color) as unknown as JsonValue,
        'image_edit.document.root_refs': document.layers.map((layer) => refForLayer(documentId, layer)),
      }
    } else if (
      this.entityType === 'image_edit.layer'
      || this.entityType === 'image_edit.group'
      || this.entityType === 'image_edit.mask'
    ) {
      const source = layerSource(ref, this.entityType)
      if (this.entityType === 'image_edit.layer') {
        values = fieldReadValues(IMAGE_EDIT_V3_LAYER_FIELDS, source)
      } else if (this.entityType === 'image_edit.group') {
        values = fieldReadValues(IMAGE_EDIT_V3_GROUP_FIELDS, source)
      } else {
        values = fieldReadValues(IMAGE_EDIT_V3_MASK_FIELDS, source)
      }
    } else {
      const { documentId, resourceId } = splitImageEditV3ResourceRef(ref)
      const document = requireImageEditV3LiveSession(documentId).bus.getSnapshot().document
      const usage = collectResources(document).find((item) => item.resourceId === resourceId)
      if (!usage) throw new Error('NOT_FOUND')
      const locations = collectImageEditV3LiveLayers(document)
      values = {
        'image_edit.resource.document_ref': imageEditV3DocumentRef(documentId),
        'image_edit.resource.resource_id': resourceId,
        'image_edit.resource.roles': [...usage.roles].sort(),
        'image_edit.resource.layer_refs': [...usage.layerIds].flatMap((layerId) => {
          const location = locations.find(({ layer }) => layer.id === layerId)
          return location ? [refForLayer(documentId, location.layer)] : []
        }),
      }
    }
    return {
      ref,
      entityType: this.entityType,
      revisions: { image_edit: revision },
      properties: selectProperties(values, request.propertyIds),
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(
    ref: ApplicationRef,
    propertyIds: string[],
  ): Promise<ApplicationPropertyAvailability[]> {
    if (
      this.entityType === 'image_edit.layer'
      || this.entityType === 'image_edit.group'
      || this.entityType === 'image_edit.mask'
    ) {
      return layerAvailability(ref, this.entityType, propertyIds)
    }
    await this.readEntity(ref, { propertyIds: [] })
    const descriptors = new Map(IMAGE_EDIT_V3_PROPERTIES[this.entityType].map((item) => [item.id, item]))
    return propertyIds.map((propertyId) => {
      const descriptor = descriptors.get(propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return {
        propertyId,
        readable: true,
        writable: false,
        reasons: [descriptor.readOnlyReason ?? READ_ONLY_DOCUMENT],
        requiredPermissions: descriptor.requiredPermissions.read,
        revisions: { image_edit: getImageEditV3LiveRevision() },
      }
    })
  }

  async getCollectionAvailability(parent: ApplicationRef): Promise<ApplicationCollectionAvailability> {
    const revision = { image_edit: getImageEditV3LiveRevision() }
    if (this.entityType !== 'image_edit.layer' && this.entityType !== 'image_edit.group') {
      return unrestrictedCollectionAvailability(this.entityType, parent, revision, ['image_edit:write'])
    }
    if (parent.kind === 'image_edit.document') {
      const { documentId } = splitImageEditV3DocumentRef(parent)
      requireImageEditV3LiveSession(documentId)
      return unrestrictedCollectionAvailability(this.entityType, parent, revision, ['image_edit:write'])
    }
    const source = layerSource(parent, 'image_edit.group')
    const blocked = source.location.layer.locked
      || source.location.ancestors.some((ancestor) => ancestor.locked)
    const availability = unrestrictedCollectionAvailability(
      this.entityType,
      parent,
      revision,
      ['image_edit:write'],
    )
    if (!blocked) return availability
    const reason = '目标图层组已锁定，不能增删其子图层。'
    const block = {
      kind: 'state' as const,
      requirementId: 'image_edit.group.unlocked',
      affectedEntityTypes: ['image_edit.group'],
      revisionScopes: ['image_edit'],
    }
    return {
      ...availability,
      create: { ...availability.create, available: false, reasons: [reason], blocks: [block] },
      remove: { ...availability.remove, available: false, reasons: [reason], blocks: [block] },
    }
  }
}
