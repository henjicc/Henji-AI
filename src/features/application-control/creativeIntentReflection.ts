import { z } from 'zod'
import { fieldDescriptors, fieldReadValues, unrestrictedCollectionAvailability, type ApplicationEntityRegistration, type JsonValue } from '@/core/application-control'
import { motionDraftSchema, takeSchema, pinSchema, resourceRefSchema } from '@/core/creativeIntent/contracts'
import { storedMotionCandidateSchema } from '@/core/creativeIntent/persistence'
import { imageLayoutCandidateSchema } from '@/core/imageEdit/v3/layoutDraft'
import { creativeIntentFields, creativeIntentSchemaRef } from './creativeIntentFields'
import { intentDocuments, intentHost, intentRecord, intentRef, intentRevisions, intentProvider, type IntentDomain, type IntentEntity } from './creativeIntentHost'
const schemas = { intent_draft: motionDraftSchema, intent_take: takeSchema, intent_pin: pinSchema, intent_candidate: resourceRefSchema }
const titles = { intent_draft: '超级关键帧与随手摆原稿', intent_take: '原稿示范段', intent_pin: '钉住姿态', intent_candidate: '整理候选' }
export function creativeIntentRegistration(domain: IntentDomain, type: IntentEntity): ApplicationEntityRegistration {
  const entityType = `${domain}.${type}`, fields = creativeIntentFields(domain, type)
  const candidateSchema = domain === 'video_edit' ? storedMotionCandidateSchema : imageLayoutCandidateSchema
  const detailSchema = type === 'intent_candidate' ? z.object({ resource: resourceRefSchema, proposal: candidateSchema }).strict() : schemas[type]
  return {
    entity: { id: entityType, domain, version: 1, title: titles[type], description: '读取原稿、示范、钉点与候选。整理仅生成候选；用户确认后写候选 applied=true，整组结果可撤销。', refKind: entityType,
      dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [type === 'intent_draft' ? `${domain}.document` : `${domain}.intent_draft`], revisionScopes: [domain], queryCapabilityIds: ['read_application_entity'], schemaRef: creativeIntentSchemaRef('entity', entityType),
      ...(['intent_draft', 'intent_pin', ...(domain === 'video_edit' ? ['intent_take'] : [])].includes(type) ? { collectionWrite: { creatable: true, removable: true, requiredPropertyIds: [`${entityType}.${type === 'intent_pin' ? 'sample_id' : 'source_ref'}`], maxItemsPerChange: 256 } } : {}),
      ...(type === 'intent_take' && domain === 'image_edit' ? { writeExclusion: { reason: '图片示范段记录不可变采样证据；静态布局使用所有目标，通过原稿保真度和钉住姿态校正。' } } : {}),
    },
    properties: fieldDescriptors(fields),
    schemaDocuments: [{ ref: creativeIntentSchemaRef('property', `${entityType}.details.value`), value: z.toJSONSchema(detailSchema, { io: 'input' }) as JsonValue }],
    provider: {
      entityType,
      async listEntities(request) {
        const refs = intentDocuments(domain).flatMap(document => intentHost(document).read().drafts.flatMap(draft => type === 'intent_draft' ? [intentRef(document, type, draft.id)] : (type === 'intent_take' ? draft.takes.map(t => t.id) : type === 'intent_pin' ? draft.pins.map(p => p.id) : draft.candidateRefs.map(c => c.resourceId)).map(id => intentRef(document, type, draft.id, id))))
        const offset = request.cursor ? Number(request.cursor) : 0
        if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('目录游标无效，请重新读取第一页。')
        return { refs: refs.slice(offset, offset + request.limit), nextCursor: offset + request.limit < refs.length ? String(offset + request.limit) : null, revisions: intentRevisions(domain), total: refs.length }
      },
      async readEntity(ref, request) {
        const record = intentRecord(ref)
        let candidate: unknown
        if (type === 'intent_candidate' && (!request.propertyIds?.length || request.propertyIds.includes(`${entityType}.details`))) {
          const resource = record.head.resources.find(r => r.resourceId === record.childId && r.kind === 'candidate')
          if (!resource) throw new Error('候选资源缺失，请重新整理。')
          candidate = candidateSchema.parse(await intentProvider(domain).readResource(resource))
          record.host.assertCurrent()
          if (record.host.read() !== record.head) throw new Error('原稿已变化，请重新读取候选。')
        }
        const properties = fieldReadValues(fields, { ...record, candidate })
        return { ref, entityType, properties: Object.fromEntries(Object.entries(properties).filter(([key]) => !request.propertyIds?.length || request.propertyIds.includes(key))), revisions: intentRevisions(domain), capturedAt: new Date().toISOString() }
      },
      async getPropertyAvailability(ref, ids) {
        intentRecord(ref)
        return ids.map(propertyId => { const field = fields.find(f => f.propertyId === propertyId); if (!field) throw new Error(`未知属性 ${propertyId}；可用：${fields.map(f => f.propertyId).join('、')}`)
          return { propertyId, readable: true, writable: Boolean(field.writer), reasons: field.writer ? [] : [field.descriptor.readOnlyReason!], requiredPermissions: [`${domain}:${field.writer ? 'write' : 'read'}`], revisions: intentRevisions(domain) } })
      },
      async getCollectionAvailability(parent) { return unrestrictedCollectionAvailability(entityType, parent, intentRevisions(domain), [`${domain}:write`]) },
    },
  }
}
