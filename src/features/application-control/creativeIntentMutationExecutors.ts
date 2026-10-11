import { applyWriterTable, fieldWriterTable, propertyOperations, writableProperties, type ApplicationMutationExecutor, type ApplicationCompletedStepResult, type ApplicationPlannedStep, type ApplicationExecutionContext, type ApplicationEffectContract } from '@/core/application-control'
import { creativeIntentFields, type IntentWrite } from './creativeIntentFields'
import { intentRecord, intentRevisions, type IntentDomain, type IntentEntity } from './creativeIntentHost'
import { createLogger } from '@/core/logging'
import { ApplicationExecutionProgressFailure } from '@/core/application-control/execution/persistence'
const logger = createLogger('features.applicationControl.creativeIntent')
type Step = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
const undos = new Map<string, () => Promise<ApplicationCompletedStepResult>>()
export function intentResult(refs: ApplicationCompletedStepResult['directRefs'], domain: IntentDomain): ApplicationCompletedStepResult { return { status: 'completed', directRefs: refs, resultingRevisions: intentRevisions(domain), evidence: [{ kind: 'entity_state', fact: '原稿与候选已从正式文档读回；作品只在确认应用时改变。', capturedAt: new Date().toISOString() }] } }
export function retainIntentUndo(restore: () => Promise<void>, refs: ApplicationCompletedStepResult['directRefs'], domain: IntentDomain): string {
  const token = crypto.randomUUID(); undos.set(token, async () => { await restore(); undos.delete(token); return intentResult(refs, domain) }); return token
}
export async function undoIntent(token: string) { const restore = undos.get(token); if (!restore) throw new Error('原撤销记录已失效，请读取文档历史。'); return restore() }
export class CreativeIntentMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType: string
  readonly table
  readonly writableProperties
  readonly propertyOperations
  readonly effectContract: ApplicationEffectContract
  constructor(readonly domain: IntentDomain, type: IntentEntity) {
    this.entityType = `${domain}.${type}`; this.table = fieldWriterTable(creativeIntentFields(domain, type)); this.writableProperties = writableProperties(this.table); this.propertyOperations = propertyOperations(this.table)
    this.effectContract = { direct: [], cascades: type === 'intent_candidate' ? (domain === 'video_edit' ? ['video_edit.clip'] : ['image_edit.layer', 'image_edit.group']).map(entityType => ({ declarationId: `${domain}.intent.apply.${entityType.split('.').at(-1)}`, effect: 'update', entityType, propertyIds: [], revisionScopes: [domain] })) : [] }
  }
  async apply(step: Step, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    const record = intentRecord(step.target), finish = record.host.checkpoint()
    const state: IntentWrite = { record, writes: [], context }
    await applyWriterTable(this.table, state, step.mutations)
    logger.info('原稿修改开始', { event: 'creative_intent.change.start', requestId: context.requestId, entityType: this.entityType })
    try {
      for (const write of state.writes) { context.signal?.throwIfAborted(); await write(); record.host.assertCurrent() }
      const result = intentResult([step.target], this.domain)
      if (step.mutations.some(m => m.propertyId === `${this.entityType}.applied` && m.value === true) && !record.draft.applications.some(a => a.candidateRef === record.childId)) result.cascadeEffects = this.effectContract.cascades.flatMap(declaration => {
        const refs = record.draft.targets.filter(t => t.ref.kind === declaration.entityType).map(t => t.ref)
        return refs.length ? [{ effect: declaration.effect, entityType: declaration.entityType, propertyIds: [], refs, origin: { kind: 'cascade' as const, declarationId: declaration.declarationId } }] : []
      })
      result.undoToken = retainIntentUndo(finish(), [step.target], this.domain)
      logger.info('原稿修改完成', { event: 'creative_intent.change.completed', requestId: context.requestId, entityType: this.entityType })
      return result
    } catch (error) {
      logger.warn('原稿修改未完成', { event: 'creative_intent.change.failed', requestId: context.requestId, entityType: this.entityType, error })
      const current = record.host.read().drafts.find(d => d.id === record.draftId)
      if (current?.applications.some(a => !a.saved && !record.draft.applications.some(before => before.operationRef.id === a.operationRef.id))) {
        const result = { ...intentResult([step.target], this.domain), undoToken: retainIntentUndo(finish(), [step.target], this.domain) }
        throw new ApplicationExecutionProgressFailure('候选已应用但保存未完成；请重试保存，不要再次生成或应用。', [result], [], error)
      }
      if (JSON.stringify(record.host.read()) !== JSON.stringify(record.head)) await finish()()
      throw error
    }
  }
  async undo(token: string) { return undoIntent(token) }
  async compensate(_step: Step, result: ApplicationCompletedStepResult) { if (result.undoToken) await undoIntent(result.undoToken); return [] }
}
