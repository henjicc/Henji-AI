import { unrestrictedCollectionAvailability, type ApplicationEntityRegistration, type JsonValue } from '@/core/application-control'
import { videoEditSchemaRef } from './videoEditFields'
import { listVideoEditInstances, requireVideoEditInstance, videoEditDomainRevision } from './videoEditService'

const entityType = 'video_edit.explanation_session'
const reason = '麦克风采集需用户在本机阅读范围并授权；音频、词稿、指向原稿由正式录制服务维护，不能通过属性写入伪造或复制。此实体只读非私密会话状态。音频外发需独立确认；文字与图像尚未授权外发，不经助手读取。'
const fields = [
  { key: 'state', title: '讲解阶段', value: { kind: 'string' as const } },
  { key: 'audio_retention', title: '原音留存选择', value: { kind: 'string' as const } },
  { key: 'audio_upload_allowed', title: '已确认音频外发', value: { kind: 'boolean' as const } },
]
export function createVideoEditExplanationRegistration(): ApplicationEntityRegistration {
  const revisions = () => ({ video_edit: videoEditDomainRevision() })
  const requireSession = (ref: { kind: string; id: string }) => {
    const split = ref.id.indexOf(':'); if (ref.kind !== entityType || split < 0) throw new Error('请使用讲解目录返回的完整引用。')
    const owner = requireVideoEditInstance(ref.id.slice(0, split)); const session = owner.document.creativeIntents?.sessions.find(s => s.id === ref.id.slice(split+1))
    if (!session) throw new Error('原讲解已经删除；不会从撤销历史恢复私密记录。')
    return session
  }
  const properties = fields.map(field => ({ id: `${entityType}.${field.key}`, entityType, version: 1, title: field.title, description: field.title, value: field.value, nullable: false, dataClass: 'C1' as const, exposures: ['ui', 'assistant', 'local_adapter'] as const, requiredPermissions: { read: ['video_edit:read'], write: [] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', `${entityType}.${field.key}`), readOnlyReason: reason }))
  return {
    entity: { id: entityType, domain: 'video_edit', version: 1, title: '录制讲解会话', description: reason, refKind: entityType, dataClass: 'C1', exposures: ['ui','assistant','local_adapter'], parentTypes: ['video_edit.document'], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity',entityType), writeExclusion: { reason } },
    properties: properties.map(p => ({ ...p, exposures: [...p.exposures] })),
    provider: {
      entityType,
      async listEntities(request) {
        const refs = listVideoEditInstances().flatMap(owner => (owner.document.creativeIntents?.sessions ?? []).map(session => ({ kind:entityType,id:`${owner.document.id}:${session.id}` })))
        const offset = Math.max(0, Number(request.cursor)||0)
        return { refs: refs.slice(offset,offset+request.limit), nextCursor:offset+request.limit<refs.length?String(offset+request.limit):null,revisions:revisions() }
      },
      async readEntity(ref,request) {
        const session = requireSession(ref); const values: Record<string,JsonValue> = { [`${entityType}.state`]:session.state,[`${entityType}.audio_retention`]:session.retentionStatus,[`${entityType}.audio_upload_allowed`]:session.consent?.audioUpload??false }
        return { ref,entityType,revisions:revisions(),properties:request.propertyIds?.length?Object.fromEntries(Object.entries(values).filter(([key])=>request.propertyIds!.includes(key))):values,capturedAt:new Date().toISOString() }
      },
      async getPropertyAvailability(ref,ids) { requireSession(ref); return ids.map(propertyId=>{ if (!properties.some(p=>p.id===propertyId)) throw new Error(`未知讲解属性：${propertyId}`); return {propertyId,readable:true,writable:false,reasons:[reason],requiredPermissions:['video_edit:read'],revisions:revisions()} }) },
      async getCollectionAvailability(parent) { const available = unrestrictedCollectionAvailability(entityType,parent,revisions(),['video_edit:read']); available.create={...available.create,available:false,reasons:[reason]}; available.remove={...available.remove,available:false,reasons:[reason]}; return available },
    },
  }
}
