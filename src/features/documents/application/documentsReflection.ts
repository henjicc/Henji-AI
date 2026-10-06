import {
  fieldDescriptors,
  fieldReadValues,
  unrestrictedCollectionAvailability,
  type ApplicationEntityListRequest,
  type ApplicationEntityListResult,
  type ApplicationEntityProvider,
  type ApplicationEntityReadRequest,
  type ApplicationEntityRegistration,
  type ApplicationEntitySnapshot,
  type ApplicationPropertyAvailability,
  type ApplicationRef,
  type JsonValue,
  type ApplicationCollectionAvailability,
} from '@/core/application-control'

import { getDocumentOperations, type DocumentOperations } from '../documentOperations'
import { DOCUMENT_FIELDS, DOCUMENTS_ENTITY_TYPES, PROJECT_FIELDS, documentsSchemaRef, type DocumentsEntityType } from './documentsFields'

/*
 * 通用文档与项目的反射注册（存储底座 2.5）：读取经通用文档操作服务（作品索引），
 * 与项目页同一个数据源。revision 作用域 `documents` 取服务的写入计数。
 */

export function documentsRevisions(operations: DocumentOperations = getDocumentOperations()): Record<string, number> {
  return { documents: operations.revision() }
}

function page<T>(items: T[], request: ApplicationEntityListRequest): { items: T[]; nextCursor: string | null } {
  const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
  const slice = items.slice(offset, offset + request.limit)
  return { items: slice, nextCursor: offset + slice.length < items.length ? String(offset + slice.length) : null }
}

function pick(values: Record<string, JsonValue>, propertyIds: string[] | undefined): Record<string, JsonValue> {
  if (!propertyIds) return values
  const requested = new Set(propertyIds)
  return Object.fromEntries(Object.entries(values).filter(([id]) => requested.has(id)))
}

class DocumentsReflectionProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: DocumentsEntityType, private readonly operations: () => DocumentOperations) {}

  async listEntities(request: ApplicationEntityListRequest): Promise<ApplicationEntityListResult> {
    const operations = this.operations()
    const refs: ApplicationRef[] = this.entityType === DOCUMENTS_ENTITY_TYPES.document
      ? (await operations.listDocuments({ container: { kind: 'any' }, includeDrafts: true, includeMissing: true })).map((document) => ({ kind: this.entityType, id: document.id, label: document.name }))
      : (await operations.listProjects({ includeDrafts: true, includeMissing: true })).map((project) => ({ kind: this.entityType, id: project.id, label: project.name }))
    const { items, nextCursor } = page(refs, request)
    return { refs: items, nextCursor, revisions: documentsRevisions(operations) }
  }

  async readEntity(ref: ApplicationRef, request: ApplicationEntityReadRequest): Promise<ApplicationEntitySnapshot> {
    const values = await this.readValues(ref)
    return {
      ref, entityType: this.entityType, revisions: documentsRevisions(this.operations()),
      properties: pick(values.values, request.propertyIds), capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]): Promise<ApplicationPropertyAvailability[]> {
    const { missing } = await this.readValues(ref)
    const descriptors = new Map([...fieldDescriptors(DOCUMENT_FIELDS), ...fieldDescriptors(PROJECT_FIELDS)].map((item) => [item.id, item]))
    return propertyIds.map((propertyId) => {
      const descriptor = descriptors.get(propertyId)
      if (!descriptor || descriptor.entityType !== this.entityType) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      const reason = descriptor.readOnlyReason || (missing ? '文件找不到，不能改名；请先确认文件位置后刷新列表。' : '')
      return {
        propertyId, readable: true, writable: !reason, reasons: reason ? [reason] : [],
        requiredPermissions: descriptor.requiredPermissions.write.length ? descriptor.requiredPermissions.write : descriptor.requiredPermissions.read,
        revisions: documentsRevisions(this.operations()),
      }
    })
  }

  async getCollectionAvailability(parent: ApplicationRef): Promise<ApplicationCollectionAvailability> {
    return unrestrictedCollectionAvailability(this.entityType, parent, documentsRevisions(this.operations()), [])
  }

  private async readValues(ref: ApplicationRef): Promise<{ values: Record<string, JsonValue>; missing: boolean }> {
    if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    const operations = this.operations()
    if (this.entityType === DOCUMENTS_ENTITY_TYPES.document) {
      const document = await operations.findDocument(ref.id)
      return { values: fieldReadValues(DOCUMENT_FIELDS, { document }), missing: document.missing }
    }
    const project = await operations.findProject(ref.id)
    return { values: fieldReadValues(PROJECT_FIELDS, { project }), missing: project.missing }
  }
}

const ENTITY_META: Record<DocumentsEntityType, { title: string; description: string }> = {
  [DOCUMENTS_ENTITY_TYPES.document]: {
    title: '文档',
    description: '剪辑、画布、口播、镜头参考、图片文档等作品文件；名称可改，位置用 move_document、副本用 duplicate_document、收集素材进项目用 collect_document_media、删除用 trash_document。',
  },
  [DOCUMENTS_ENTITY_TYPES.project]: {
    title: '项目',
    description: '装文档与素材的文件夹（总项目）；名称可改，新建用 create_project。',
  },
}

export function createDocumentsReflectionRegistrations(operations: () => DocumentOperations = getDocumentOperations): ApplicationEntityRegistration[] {
  return Object.values(DOCUMENTS_ENTITY_TYPES).map((entityType) => ({
    entity: {
      id: entityType, domain: 'documents', version: 1, title: ENTITY_META[entityType].title,
      description: ENTITY_META[entityType].description, refKind: entityType,
      dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [],
      revisionScopes: ['documents'], queryCapabilityIds: ['read_application_entity'], schemaRef: documentsSchemaRef('entity', entityType),
    },
    properties: entityType === DOCUMENTS_ENTITY_TYPES.document ? fieldDescriptors(DOCUMENT_FIELDS) : fieldDescriptors(PROJECT_FIELDS),
    provider: new DocumentsReflectionProvider(entityType, operations),
  }))
}
