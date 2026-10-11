import { z } from 'zod'
import type { ApplicationFieldDefinition, ApplicationSchemaRef, JsonValue } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { intentRecord, type IntentDomain, type IntentEntity } from './creativeIntentHost'

export type IntentRecord = ReturnType<typeof intentRecord> & { candidate?: unknown }
export interface IntentWrite { record: IntentRecord; writes: (() => Promise<void>)[] }
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
export function creativeIntentSchemaRef(kind: 'entity' | 'property', id: string): ApplicationSchemaRef {
  const hash = [...id].reduce((result, char) => (result * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${hash.repeat(64).slice(0, 64)}` }
}
export function creativeIntentFields(domain: IntentDomain, type: IntentEntity): ApplicationFieldDefinition<IntentRecord, IntentWrite>[] {
  const entityType = `${domain}.${type}`
  const field = (key: string, title: string, value: ApplicationFieldDefinition<IntentRecord, IntentWrite>['descriptor']['value'], read: (record: IntentRecord) => JsonValue,
    write?: (record: IntentRecord, value: JsonValue) => Promise<void>): ApplicationFieldDefinition<IntentRecord, IntentWrite> => ({
    propertyId: `${entityType}.${key}`, storeActions: [], read,
    descriptor: { id: `${entityType}.${key}`, entityType, version: 1, title, description: title, value, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
      requiredPermissions: { read: [`${domain}:read`], write: write ? [`${domain}:write`] : [] }, revisionScopes: [domain], schemaRef: creativeIntentSchemaRef('property', `${entityType}.${key}`),
      ...(!write ? { readOnlyReason: '由原稿采集、候选整理与正式应用回执维护；原始证据不可伪造。' } : {}) },
    ...(write ? { writer: { write: (state: IntentWrite, mutation: { value?: JsonValue }) => { const value = mutation.value; if (value === undefined) throw new Error('请提供属性值。'); state.writes.push(() => write(intentRecord(state.record.ref), value)) } } } : {}),
  })
  const detail = field('details', '原稿结构、候选内容与应用回执', { kind: 'json', schemaRef: creativeIntentSchemaRef('property', `${entityType}.details.value`) }, r => json(type === 'intent_candidate' ? { resource: r.item, proposal: r.candidate } : r.item))
  if (type === 'intent_draft') return [detail,
    field('label', '原稿名称', { kind: 'string' }, r => r.draft.label, async (r, value) => {
      const label = z.string().parse(value), head = structuredClone(r.host.read()); head.drafts.find(d => d.id === r.draftId)!.label = label; r.host.commit(head)
    }),
    field('fidelity', '保真度，0 为美化、1 为保留示范', { kind: 'number', hardRange: { min: 0, max: 1 } }, r => r.draft.fidelity, async (r, value) => { const fidelity = z.number().min(0).max(1).parse(value); await r.host.prepare(r.draft); await r.host.configure({ fidelity }) }),
  ]
  if (type === 'intent_take') return [detail, ...(domain === 'video_edit' ? [field('included', '是否采用这段示范，排除不会删除原始记录', { kind: 'boolean' }, r => !(r.head.motionOptions?.find(o => o.draftId === r.draftId)?.selectedTakeIds) || r.head.motionOptions!.find(o => o.draftId === r.draftId)!.selectedTakeIds!.includes(r.childId!), async (r, value) => {
    const included = z.boolean().parse(value), current = r.head.motionOptions?.find(o => o.draftId === r.draftId)?.selectedTakeIds ?? r.draft.takes.map(t => t.id)
    const ids = included ? [...new Set([...current, r.childId!])] : current.filter(id => id !== r.childId)
    await r.host.prepare(r.draft); await r.host.configure({ selectedTakeIds: ids })
  })] : [])]
  if (type === 'intent_pin') return [detail, field('sample_id', '原稿姿态标识；创建钉点时填入，不得编造', { kind: 'string' }, r => r.draft.pins.find(p => p.id === r.childId)!.sampleId)]
  return [detail,
    field('selected', '选中候选供预览；不会应用作品', { kind: 'boolean' }, r => r.host.selected(r.draft) === r.childId, async (r, value) => { if (value !== true) throw new Error('请选择另一候选；selected 只接受 true。'); await r.host.prepare(r.draft); await r.host.select(r.childId!) }),
    field('saved', '候选应用是否保存完成；失败后写 true 只恢复保存，不重复应用', { kind: 'boolean' }, r => r.draft.applications.some(a => a.candidateRef === r.childId && a.saved), async (r, value) => {
      if (value !== true) throw new Error('保存只接受 true；不能伪造保存失败。')
      const application = r.draft.applications.find(a => a.candidateRef === r.childId)
      if (!application) throw new Error('候选尚未应用，请先由用户确认应用。')
      if (application.saved) return
      await r.host.prepare(r.draft); await r.host.apply()
    }),
    field('applied', '用户确认后应用此候选；仅接受 true，整组结果可一次撤销', { kind: 'boolean' }, r => r.draft.applications.some(a => a.candidateRef === r.childId), async (r, value) => {
      if (value !== true) throw new Error('应用只接受 true；恢复作品请撤销事务。')
      const application = r.draft.applications.find(a => a.candidateRef === r.childId)
      if (application?.saved) { await r.host.save(); return }
      await r.host.prepare(r.draft)
      // The original host owns recovery and its saved receipt; do not replay selection/application.
      if (!application) await r.host.select(r.childId!)
      await r.host.apply()
    }),
  ]
}
