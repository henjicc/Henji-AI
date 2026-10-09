import {
  fieldDescriptors,
  fieldReadValues,
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationRef,
  unrestrictedCollectionAvailability,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { type ImageMarkDoc, type MarkItem } from '@/core/imageEdit'
import { requireImageEditDocumentInstanceV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import { listImageEditDocumentEntitiesV3 } from '@/features/imageEdit/v3/application/imageEditDocumentCatalog'
import { collectImageEditV3LiveLayers, findImageEditV3LiveLayer, imageEditV3AnnotationRef, isImageEditV3Ref, splitImageEditV3AnnotationRef, splitImageEditV3LayerRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'
import { ensureImageEditRefInstanceV3 } from '@/features/imageEdit/v3/application/imageEditDocumentLoading'

import { IMAGE_MARK_ANNOTATION_FIELDS, IMAGE_MARK_ENTITY_TYPES } from './imageMarkFields'
import { imageMarkRevision } from './imageMarkSessionAccess'
import { IMAGE_EDIT_PREVIEW_ONLY_REASON, imageEditPersistenceAvailabilityV3, imageEditPersistenceRevisionsV3, imageEditPersistencePermissionsV3 } from '@/features/imageEdit/v3/application/imageEditPersistenceOperations'

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function schemaRef(kind: 'entity' | 'property', id: string) {
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: digest(`${kind}:${id}`) } as const
}

function findAnnotation(markDoc: ImageMarkDoc, annotationId: string): MarkItem {
  const item = markDoc.items.find((candidate) => candidate.id === annotationId)
  if (!item) throw new Error('NOT_FOUND')
  return item
}

/** 标注集合从保存文档及当前实例发现，文档无需先挂载编辑器。 */
class ImageMarkAnnotationReflectionProvider implements ApplicationEntityProvider {
  readonly entityType = IMAGE_MARK_ENTITY_TYPES.annotation

  async listEntities(request: { cursor?: string; limit: number }) {
    const current = await listImageEditDocumentEntitiesV3(request, (document) =>
      collectImageEditV3LiveLayers(document).flatMap(({ layer }) =>
        layer.type === 'annotation' ? layer.annotations.map(item => imageEditV3AnnotationRef(document.id, layer.id, item.id)) : []))
    return { ...current, revisions: { image_mark: imageMarkRevision(), image_edit: imageMarkRevision() } }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    await ensureImageEditRefInstanceV3(ref)
    const { documentId, layerId, annotationId } = splitImageEditV3AnnotationRef(ref)
    const document = requireImageEditDocumentInstanceV3(documentId).bus.getSnapshot().document
    const location = findImageEditV3LiveLayer(document, layerId)
    if (!location || location.layer.type !== 'annotation') throw new Error('NOT_FOUND')
    const item = location.layer.annotations.find(candidate => candidate.id === annotationId)
    if (!item) throw new Error('NOT_FOUND')
    const values = fieldReadValues(IMAGE_MARK_ANNOTATION_FIELDS, item)
    return {
      ref,
      entityType: this.entityType,
      revisions: { image_mark: imageMarkRevision(), image_edit: imageMarkRevision(), ...imageEditPersistenceRevisionsV3(ref) },
      properties: request.propertyIds ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds?.includes(id))) : values,
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    let stateReason: string | null = null
    if (isImageEditV3Ref(ref)) {
      await ensureImageEditRefInstanceV3(ref)
      const { documentId, layerId, annotationId } = splitImageEditV3AnnotationRef(ref)
      const document = requireImageEditDocumentInstanceV3(documentId).bus.getSnapshot().document
      const location = findImageEditV3LiveLayer(document, layerId)
      if (!location || location.layer.type !== 'annotation') throw new Error('NOT_FOUND')
      findAnnotation({ version: 1, orientation: { rotate: 0, mirrored: false }, crop: null, items: location.layer.annotations }, annotationId)
      if (!requireImageEditDocumentInstanceV3(documentId).persistenceOwner) stateReason = IMAGE_EDIT_PREVIEW_ONLY_REASON
      if (location.layer.locked || location.ancestors.some((ancestor) => ancestor.locked)) {
        stateReason = '标注图层或其父组已锁定。'
      }
    } else throw new Error('NOT_FOUND')
    const descriptorMap = new Map(fieldDescriptors(IMAGE_MARK_ANNOTATION_FIELDS).map((item) => [item.id, item]))
    const revisions = { image_mark: imageMarkRevision(), image_edit: imageMarkRevision(), ...imageEditPersistenceRevisionsV3(ref) }
    return propertyIds.map((propertyId) => {
      const descriptor = descriptorMap.get(propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      const writable = !descriptor.readOnlyReason && !stateReason
      return {
        propertyId,
        readable: true,
        writable,
        reasons: writable ? [] : [stateReason ?? descriptor.readOnlyReason ?? '只读状态'],
        requiredPermissions: writable ? [...descriptor.requiredPermissions.write, ...imageEditPersistencePermissionsV3(ref)] : descriptor.requiredPermissions.read,
        revisions,
      }
    })
  }

  async getCollectionAvailability(parent: ApplicationRef) {
    if (parent.kind === 'image_edit.layer' && isImageEditV3Ref(parent)) {
      await ensureImageEditRefInstanceV3(parent)
      const { documentId, layerId } = splitImageEditV3LayerRef(parent)
      const document = requireImageEditDocumentInstanceV3(documentId).bus.getSnapshot().document
      const location = findImageEditV3LiveLayer(document, layerId)
      if (!location || location.layer.type !== 'annotation') throw new Error('NOT_FOUND')
      const availability = imageEditPersistenceAvailabilityV3(documentId, unrestrictedCollectionAvailability(
        this.entityType,
        parent,
        { image_mark: imageMarkRevision(), image_edit: imageMarkRevision() },
        ['image_mark:write'],
      ))
      if (!requireImageEditDocumentInstanceV3(documentId).persistenceOwner) return imageEditPersistenceAvailabilityV3(documentId, availability)
      if (!location.layer.locked && !location.ancestors.some((ancestor) => ancestor.locked)) return availability
      const reason = '标注图层或其父组已锁定。'
      const block = {
        kind: 'state' as const,
        requirementId: 'image_edit.annotation_layer.unlocked',
        affectedEntityTypes: ['image_edit.layer'],
        revisionScopes: ['image_mark', 'image_edit'],
      }
      return {
        ...availability,
        create: { ...availability.create, available: false, reasons: [reason], blocks: [block] },
        remove: { ...availability.remove, available: false, reasons: [reason], blocks: [block] },
      }
    }
    throw new Error('NOT_FOUND')
  }
}

export function createImageMarkReflectionRegistrations(): ApplicationEntityRegistration[] {
  return [
    {
      entity: {
        id: IMAGE_MARK_ENTITY_TYPES.annotation,
        domain: 'image_mark',
        version: 1,
        title: '标注对象',
        description: 'V3 标注图层下的一条标注（画笔/矩形/箭头/文字/打码等）。',
        refKind: IMAGE_MARK_ENTITY_TYPES.annotation,
        dataClass: 'C1',
        exposures: ['ui', 'assistant', 'local_adapter'],
        parentTypes: ['image_edit.layer'],
        revisionScopes: ['image_mark', 'image_edit'],
        queryCapabilityIds: ['read_application_entity'],
        schemaRef: schemaRef('entity', IMAGE_MARK_ENTITY_TYPES.annotation),
        /**
         * 标注可增删（6.2）：此前 imageMark 是全域失明领域，助手连"打开编辑器"之后画一笔都
         * 做不到。type 与 data 是创建时的必填属性——data 的具体形状随 type 变化，由
         * sanitizeMarkItem（@/core/imageEdit/markCodec.ts）在集合执行器里统一校验。
         */
        collectionWrite: {
          creatable: true,
          removable: true,
          requiredPropertyIds: [`${IMAGE_MARK_ENTITY_TYPES.annotation}.type`, `${IMAGE_MARK_ENTITY_TYPES.annotation}.data`],
          maxItemsPerChange: 64,
        },
      },
      properties: fieldDescriptors(IMAGE_MARK_ANNOTATION_FIELDS),
      provider: new ImageMarkAnnotationReflectionProvider(),
    },
  ]
}
