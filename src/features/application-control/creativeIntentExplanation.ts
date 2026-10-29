import { z } from 'zod'
import { applyWriterTable, fieldDescriptors, fieldReadValues, fieldWriterTable, writableProperties, propertyOperations, unrestrictedCollectionAvailability, type ApplicationEntityRegistration, type ApplicationFieldDefinition, type ApplicationMutationExecutor, type ApplicationExecutionContext, type ApplicationPlannedStep, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { hasExplanationBodyEditor, explanationBodyEditor, explanationTextEditsSchema, explanationBindingsSchema, explanationBodyRef, registerExplanationBodyWriter, type ExplanationBodyChanges } from '@/core/creativeIntent/semanticIntentEdits'
import { semanticRecordingEvents } from '@/core/creativeIntent/semanticIntentRecording'
import type { ExplanationSession } from '@/core/creativeIntent/schema'
import { intentHost, intentDocuments, intentProvider, intentRevisions, type IntentDomain } from './creativeIntentHost'
import { creativeIntentSchemaRef } from './creativeIntentFields'
import { intentResult, retainIntentUndo, undoIntent } from './creativeIntentMutationExecutors'
import { createLogger } from '@/core/logging'
const logger = createLogger('features.applicationControl.creativeIntent')

export function explanationBodyRecord(ref: ApplicationRef) {
  const domain = ref.kind.split('.')[0] as IntentDomain, split = ref.id.lastIndexOf(':')
  if (!['video_edit', 'image_edit'].includes(domain) || ref.kind !== `${domain}.explanation_body` || split < 1) throw new Error('请使用讲解正文目录返回的完整引用。')
  const host = intentHost({ kind: `${domain}.document`, id: ref.id.slice(0, split) })
  const session = host.read().sessions.find(s => s.id === decodeURIComponent(ref.id.slice(split + 1)))
  if (!session) throw new Error('讲解已删除，不能恢复私密正文。')
  return { domain, host, session, ref }
}
type BodySource = { session: ExplanationSession; text: { eventId: string; text: string }[] }
function fields(domain: IntentDomain): ApplicationFieldDefinition<BodySource, ExplanationBodyChanges>[] {
  const entityType = `${domain}.explanation_body`
  const field = (key: 'text' | 'bindings', title: string): ApplicationFieldDefinition<BodySource, ExplanationBodyChanges> => ({
    propertyId: `${entityType}.${key}`, storeActions: [],
    descriptor: { id: `${entityType}.${key}`, entityType, version: 1, title, description: title, value: { kind: 'json', schemaRef: creativeIntentSchemaRef('property', `${entityType}.${key}.value`) }, nullable: false, dataClass: 'C2', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: [`${domain}:read`], write: [`${domain}:write`] }, revisionScopes: [domain], schemaRef: creativeIntentSchemaRef('property', `${entityType}.${key}`), ...(key === 'text' ? { verificationStrategy: 'execution' as const } : {}) },
    read: source => JSON.parse(JSON.stringify(key === 'text' ? source.text : source.session.bindings)) as JsonValue,
    writer: { write: (changes, mutation) => { if (key === 'text') changes.text = explanationTextEditsSchema.parse(mutation.value); else changes.bindings = explanationBindingsSchema.parse(mutation.value) } },
  })
  return [field('text', '校正词稿：按读回的 eventId 修改文字，保留时间和原始录制'), field('bindings', '确认讲解指向：使用审阅返回的完整绑定，整组可撤销')]
}
export function creativeExplanationRegistration(domain: IntentDomain): ApplicationEntityRegistration {
  const entityType = `${domain}.explanation_body`, definitions = fields(domain)
  return {
    entity: { id: entityType, domain, version: 1, title: '私密讲解正文', description: '读取校正词稿和指向。修改走同一个事务，可一步撤销；删除讲解后不可恢复。', refKind: entityType, dataClass: 'C2', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [`${domain}.document`], revisionScopes: [domain], queryCapabilityIds: ['read_application_entity'], schemaRef: creativeIntentSchemaRef('entity', entityType) },
    properties: fieldDescriptors(definitions),
    schemaDocuments: [explanationTextEditsSchema, explanationBindingsSchema].map((schema, index) => ({ ref: creativeIntentSchemaRef('property', `${entityType}.${index ? 'bindings' : 'text'}.value`), value: z.toJSONSchema(schema, { io: 'input' }) as JsonValue })),
    provider: {
      entityType,
      async listEntities(request) {
        const refs = intentDocuments(domain).flatMap(doc => intentHost(doc).read().sessions.map(session => explanationBodyRef(doc, session.id)))
        const offset = request.cursor ? Number(request.cursor) : 0
        if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('讲解目录游标无效。')
        return { refs: refs.slice(offset, offset + request.limit), nextCursor: offset + request.limit < refs.length ? String(offset + request.limit) : null, revisions: intentRevisions(domain) }
      },
      async readEntity(ref, request) {
        const record = explanationBodyRecord(ref), baseline = JSON.stringify(record.session), text: BodySource['text'] = []
        if (request.propertyIds === undefined || request.propertyIds.includes(`${entityType}.text`)) for await (const entry of semanticRecordingEvents(record.session, async id => {
          const resource = record.host.read().resources.find(r => r.resourceId === id && r.kind === 'page')
          if (!resource) throw new Error('讲解页已删除。')
          return intentProvider(domain).readResource(resource)
        })) if (entry.kind === 'transcript') text.push({ eventId: entry.eventId, text: entry.text })
        record.host.assertCurrent()
        if (JSON.stringify(record.host.read().sessions.find(s => s.id === record.session.id)) !== baseline) throw new Error('讲解已校正或删除，请重新读取。')
        const values = fieldReadValues(definitions, { session: record.session, text })
        return { ref, entityType, properties: Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds === undefined || request.propertyIds.includes(id))), revisions: intentRevisions(domain), capturedAt: new Date().toISOString() }
      },
      async getPropertyAvailability(ref, ids) {
        const { session, host } = explanationBodyRecord(ref)
        const reviewing = ['reviewing', 'recoverable'].includes(session.state), writable = reviewing && (hasExplanationBodyEditor(ref) || !!host.explanationEditor)
        return ids.map(propertyId => { if (!definitions.some(f => f.propertyId === propertyId)) throw new Error(`未知讲解属性 ${propertyId}；可用：text、bindings`); return { propertyId, readable: true, writable, reasons: writable ? [] : [reviewing ? '请先在原作品打开这段讲解。' : '请先结束录制或转写。'], requiredPermissions: [`${domain}:write`], revisions: intentRevisions(domain) } })
      },
      async getCollectionAvailability(parent) { const result = unrestrictedCollectionAvailability(entityType, parent, intentRevisions(domain), [`${domain}:write`]); result.create = { ...result.create, available: false, reasons: ['请在作品中录制讲解。'] }; result.remove = { ...result.remove, available: false, reasons: ['请在讲解面板删除整段讲解。'] }; return result },
    },
  }
}
export class CreativeExplanationMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType; readonly table; readonly writableProperties; readonly propertyOperations
  readonly effectContract = { direct: [], cascades: [] }
  constructor(readonly domain: IntentDomain) { this.entityType = `${domain}.explanation_body`; this.table = fieldWriterTable(fields(domain)); this.writableProperties = writableProperties(this.table); this.propertyOperations = propertyOperations(this.table) }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, context: ApplicationExecutionContext) {
    context.signal?.throwIfAborted()
    const record = explanationBodyRecord(step.target), before = structuredClone(record.session), editor = record.host.explanationEditor?.(record.session.id) ?? explanationBodyEditor(step.target), changes: ExplanationBodyChanges = {}
    await applyWriterTable(this.table, changes, step.mutations)
    logger.info('讲解校正开始', { event: 'creative_intent.body.change.start', requestId: context.requestId, entityType: this.entityType })
    try { await editor.apply(changes, context) }
    catch (error) { logger.warn('讲解校正未完成', { event: 'creative_intent.body.change.failed', requestId: context.requestId, entityType: this.entityType }); await editor.restore(before, context); throw error }
    const after = JSON.stringify(explanationBodyRecord(step.target).session)
    logger.info('讲解校正完成', { event: 'creative_intent.body.change.completed', requestId: context.requestId, entityType: this.entityType })
    return { ...intentResult([step.target], this.domain), undoToken: retainIntentUndo(async undoContext => {
      const current = explanationBodyRecord(step.target)
      if (JSON.stringify(current.session) !== after) throw new Error('讲解已有后续修改，请先读取当前正文。')
      await editor.restore(before, undoContext)
    }, [step.target], this.domain) }
  }
  async undo(token: string, context: ApplicationExecutionContext) { return undoIntent(token, context) }
  async compensate(_step: ApplicationPlannedStep, result: Awaited<ReturnType<CreativeExplanationMutationExecutor['apply']>>, context: ApplicationExecutionContext) { await undoIntent(result.undoToken, context); return [] }
}
export function bindExplanationBodyWriter(getEngine: () => import('@/core/application-control').ApplicationControlExecutionEngine): void {
registerExplanationBodyWriter(async (ref, changes) => {
  const engine = getEngine(), { domain } = explanationBodyRecord(ref)
  const context: ApplicationExecutionContext = { exposure: 'ui', acceptedDataClasses: new Set(['C0', 'C1', 'C2']), requestId: crypto.randomUUID() }
  const revisions = intentRevisions(domain)
  const plan = await engine.plan({ summary: '校正讲解', transactionMode: 'atomic', steps: [{ kind: 'mutation', target: ref, entityType: ref.kind, expectedRevisions: revisions, mutations: Object.entries(changes).map(([key, value]) => ({ propertyId: `${ref.kind}.${key}`, operation: 'set', value: JSON.parse(JSON.stringify(value)) as JsonValue })) }] }, context)
  const result = await engine.commit({ planRef: plan.planRef, idempotencyKey: context.requestId, expectedRevisions: revisions }, context)
  if (result.status === 'failed') throw new Error(result.message)
  if (result.status !== 'completed') throw new Error('讲解校正未完成，请重试保存。')
})

}
