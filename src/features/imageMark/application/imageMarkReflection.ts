import {
  fieldDescriptors,
  fieldReadValues,
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationRef,
  unrestrictedCollectionAvailability,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'
import { imageEditDocumentToMarkDoc, type ImageMarkDoc, type MarkItem } from '@/core/imageEdit'
import { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore'

import { IMAGE_MARK_ANNOTATION_FIELDS, IMAGE_MARK_DOCUMENT_FIELDS, IMAGE_MARK_ENTITY_TYPES } from './imageMarkFields'
import { annotationRef, documentRevision, requireSessionDocument, splitAnnotationRef } from './imageMarkSessionAccess'

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function schemaRef(kind: 'entity' | 'property', id: string) {
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: digest(`${kind}:${id}`) } as const
}

function paginate<T>(items: T[], request: { cursor?: string; limit: number }): { page: T[]; nextCursor: string | null } {
  const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
  const page = items.slice(offset, offset + request.limit)
  return { page, nextCursor: offset + page.length < items.length ? String(offset + page.length) : null }
}

/**
 * 标注文档实体（会话态单例）：只有当前打开的编辑器实例才有——与 camera_stage.playback
 * 同一先例（只对当前打开的对象有意义，未打开不列出）。这里天然更简单：imageEditSessionStore
 * 的 sessions 记录本身就是"编辑器是否打开"的信号，不需要像 playback 那样另外判断
 * "有没有播放头"。
 */
class ImageMarkDocumentReflectionProvider implements ApplicationEntityProvider {
  readonly entityType = IMAGE_MARK_ENTITY_TYPES.document

  async listEntities(request: { cursor?: string; limit: number }) {
    const sessionIds = Object.keys(useImageEditSessionStore.getState().sessions)
    const { page, nextCursor } = paginate(sessionIds, request)
    return {
      refs: page.map((sessionId) => ({ kind: this.entityType, id: sessionId })),
      nextCursor,
      revisions: { image_mark: sessionIds.length },
    }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    const document = requireSessionDocument(ref.id)
    const markDoc = imageEditDocumentToMarkDoc(document)
    const values = fieldReadValues(IMAGE_MARK_DOCUMENT_FIELDS, markDoc)
    return {
      ref,
      entityType: this.entityType,
      revisions: { image_mark: documentRevision(document) },
      properties: request.propertyIds ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds?.includes(id))) : values,
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    const document = requireSessionDocument(ref.id)
    const descriptorMap = new Map(fieldDescriptors(IMAGE_MARK_DOCUMENT_FIELDS).map((item) => [item.id, item]))
    const revisions = { image_mark: documentRevision(document) }
    return propertyIds.map((propertyId) => {
      const descriptor = descriptorMap.get(propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      const writable = !descriptor.readOnlyReason
      return {
        propertyId,
        readable: true,
        writable,
        reasons: writable ? [] : [descriptor.readOnlyReason ?? '只读状态'],
        requiredPermissions: writable ? descriptor.requiredPermissions.write : descriptor.requiredPermissions.read,
        revisions,
      }
    })
  }

  async getCollectionAvailability(parent: ApplicationRef) {
    return unrestrictedCollectionAvailability(this.entityType, parent, { image_mark: 0 }, ['image_mark:write'])
  }
}

function findAnnotation(markDoc: ImageMarkDoc, annotationId: string): MarkItem {
  const item = markDoc.items.find((candidate) => candidate.id === annotationId)
  if (!item) throw new Error('NOT_FOUND')
  return item
}

/** 标注集合实体：跨全部当前打开的会话拉平列出，与 camera_stage.state_keyframe 跨全部工程拉平是同一惯例。 */
class ImageMarkAnnotationReflectionProvider implements ApplicationEntityProvider {
  readonly entityType = IMAGE_MARK_ENTITY_TYPES.annotation

  async listEntities(request: { cursor?: string; limit: number }) {
    const sessions = useImageEditSessionStore.getState().sessions
    const refs: ApplicationRef[] = Object.entries(sessions).flatMap(([sessionId, record]) =>
      imageEditDocumentToMarkDoc(record.document).items.map((item) => annotationRef(sessionId, item))
    )
    const { page, nextCursor } = paginate(refs, request)
    return { refs: page, nextCursor, revisions: { image_mark: refs.length } }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    const { sessionId, annotationId } = splitAnnotationRef(ref)
    const document = requireSessionDocument(sessionId)
    const item = findAnnotation(imageEditDocumentToMarkDoc(document), annotationId)
    const values = fieldReadValues(IMAGE_MARK_ANNOTATION_FIELDS, item)
    return {
      ref,
      entityType: this.entityType,
      revisions: { image_mark: documentRevision(document) },
      properties: request.propertyIds ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds?.includes(id))) : values,
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    const { sessionId, annotationId } = splitAnnotationRef(ref)
    const document = requireSessionDocument(sessionId)
    findAnnotation(imageEditDocumentToMarkDoc(document), annotationId)
    const descriptorMap = new Map(fieldDescriptors(IMAGE_MARK_ANNOTATION_FIELDS).map((item) => [item.id, item]))
    const revisions = { image_mark: documentRevision(document) }
    return propertyIds.map((propertyId) => {
      const descriptor = descriptorMap.get(propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      const writable = !descriptor.readOnlyReason
      return {
        propertyId,
        readable: true,
        writable,
        reasons: writable ? [] : [descriptor.readOnlyReason ?? '只读状态'],
        requiredPermissions: writable ? descriptor.requiredPermissions.write : descriptor.requiredPermissions.read,
        revisions,
      }
    })
  }

  async getCollectionAvailability(parent: ApplicationRef) {
    const document = requireSessionDocument(parent.id)
    return unrestrictedCollectionAvailability(
      this.entityType,
      parent,
      { image_mark: documentRevision(document) },
      ['image_mark:write'],
    )
  }
}

export function createImageMarkReflectionRegistrations(): ApplicationEntityRegistration[] {
  return [
    {
      entity: {
        id: IMAGE_MARK_ENTITY_TYPES.document,
        domain: 'image_mark',
        version: 1,
        title: '标注文档',
        description: '一次图片标注编辑会话的文档：旋转/镜像与裁剪矩形。只在编辑器打开期间存在。',
        refKind: IMAGE_MARK_ENTITY_TYPES.document,
        dataClass: 'C1',
        exposures: ['ui', 'assistant', 'local_adapter'],
        parentTypes: [],
        revisionScopes: ['image_mark'],
        queryCapabilityIds: ['read_application_entity'],
        schemaRef: schemaRef('entity', IMAGE_MARK_ENTITY_TYPES.document),
      },
      properties: fieldDescriptors(IMAGE_MARK_DOCUMENT_FIELDS),
      provider: new ImageMarkDocumentReflectionProvider(),
    },
    {
      entity: {
        id: IMAGE_MARK_ENTITY_TYPES.annotation,
        domain: 'image_mark',
        version: 1,
        title: '标注对象',
        description: '标注文档下的一条标注（画笔/矩形/箭头/文字/打码等），挂在 image_mark.document 下。',
        refKind: IMAGE_MARK_ENTITY_TYPES.annotation,
        dataClass: 'C1',
        exposures: ['ui', 'assistant', 'local_adapter'],
        parentTypes: [IMAGE_MARK_ENTITY_TYPES.document],
        revisionScopes: ['image_mark'],
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
