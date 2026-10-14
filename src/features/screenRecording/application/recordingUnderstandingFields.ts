import { z } from 'zod'
import { fieldDescriptors, fieldReadValues, fieldWriterTable, unrestrictedCollectionAvailability, type ApplicationEntityRegistration, type ApplicationFieldDefinition, type ApplicationSchemaRef, type JsonValue } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { recordingUnderstandingSchema, type RecordingUnderstanding } from '@/core/screenRecording/understanding'
import { getPlatform } from '@/platform'
import { readRecordingUnderstanding } from './recordingUnderstandingService'

export const UNDERSTANDING_ENTITY = 'screen_recording.understanding'
export const UNDERSTANDING_PROPERTY = `${UNDERSTANDING_ENTITY}.result`
export function understandingSchemaRef(kind: 'entity' | 'property', id: string): ApplicationSchemaRef {
  const hash = [...`${id}:2`].reduce((v, c) => (v * 33 + c.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 2, digest: `sha256:${hash.padEnd(64, hash).slice(0, 64)}` }
}
export const understandingFields: ApplicationFieldDefinition<RecordingUnderstanding, { value?: RecordingUnderstanding }>[] = [{
  propertyId: UNDERSTANDING_PROPERTY, storeActions: [],
  descriptor: { id: UNDERSTANDING_PROPERTY, entityType: UNDERSTANDING_ENTITY, version: 2, title: '文字稿、步骤、剪辑与打码候选',
    description: '先读取完整结果，再 set 校正标题、说明、时间、章节及剪辑候选 pending/accepted/rejected；privacy.candidates 是敏感信息候选，status accepted 表示确认打码，rejected 表示忽略，pending 尚未确认。支持逐条或全部确认，保留完整其余字段。微秒时间与原录制同钟，确认不会删除原片。可用返回的 undoRef 撤销。',
    value: { kind: 'json', schemaRef: understandingSchemaRef('property', `${UNDERSTANDING_PROPERTY}.value`) }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['screen_recording:read'], write: ['screen_recording:write'] }, revisionScopes: ['screen_recording'], requiresReadBaseline: true, schemaRef: understandingSchemaRef('property', UNDERSTANDING_PROPERTY),
  },
  read: value => value,
  writer: { write: (draft, mutation) => { draft.value = recordingUnderstandingSchema.parse(mutation.value) } },
}]
export const understandingWriterTable = fieldWriterTable(understandingFields)
export function recordingUnderstandingRegistration(): ApplicationEntityRegistration {
  const entityType = UNDERSTANDING_ENTITY
  return {
    entity: { id: entityType, domain: 'screen_recording', version: 2, title: '录制理解结果', description: '已保存会话的文字稿、可编辑步骤与敏感信息候选；引用 id 与录制会话一致。', refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: ['screen_recording'], queryCapabilityIds: ['read_application_entity'], schemaRef: understandingSchemaRef('entity', entityType) },
    properties: fieldDescriptors(understandingFields),
    schemaDocuments: [{ ref: understandingSchemaRef('property', `${UNDERSTANDING_PROPERTY}.value`), value: z.toJSONSchema(recordingUnderstandingSchema) as JsonValue }],
    provider: {
      entityType,
      async listEntities(request) {
        const offset = Number(request.cursor ?? 0)
        if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('分页位置无效')
        const docs = await getPlatform().documents.listDocuments({ kind: 'screen_recording', includeMissing: false })
        return { refs: docs.slice(offset, offset + request.limit).map(doc => ({ kind: entityType, id: doc.id, label: doc.name })), nextCursor: offset + request.limit < docs.length ? String(offset + request.limit) : null, revisions: { screen_recording: 0 } }
      },
      async readEntity(ref, request) {
        if (ref.kind !== entityType) throw new Error('请选择录制理解结果引用。')
        const read = await readRecordingUnderstanding(ref.id)
        return { ref, entityType, revisions: { screen_recording: read.meta.revision }, capturedAt: new Date().toISOString(), properties: Object.fromEntries(Object.entries(fieldReadValues(understandingFields, read.content.understanding)).filter(([id]) => !request.propertyIds || request.propertyIds.includes(id))) }
      },
      async getPropertyAvailability(ref, ids) {
        const read = await readRecordingUnderstanding(ref.id), writable = ['stopped', 'interrupted'].includes(read.content.status)
        return ids.map(propertyId => {
          if (!understandingFields.some(field => field.propertyId === propertyId)) throw new Error(`未知属性 ${propertyId}，请使用 ${UNDERSTANDING_PROPERTY}`)
          return { propertyId, readable: true, writable, reasons: writable ? [] : ['请先停止录制或恢复中断的会话。'], requiredPermissions: ['screen_recording:write'], revisions: { screen_recording: read.meta.revision } }
        })
      },
      async getCollectionAvailability(parent) { return unrestrictedCollectionAvailability(entityType, parent, { screen_recording: 0 }, []) },
    },
  }
}
