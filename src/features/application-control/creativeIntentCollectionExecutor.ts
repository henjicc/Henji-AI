import { z } from 'zod'
import type { ApplicationCollectionExecutor, ApplicationCompletedStepResult, ApplicationExecutionContext, ApplicationPlannedStep, ApplicationRef } from '@/core/application-control'
import { intentRecord, intentRef, type IntentDomain } from './creativeIntentHost'
import { intentResult, retainIntentUndo, undoIntent } from './creativeIntentMutationExecutors'
type Step = Extract<ApplicationPlannedStep, { kind: 'collection' }>
export class CreativeIntentPinCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType: string
  readonly effectContract = { direct: [], cascades: [] }
  constructor(readonly domain: IntentDomain) { this.entityType = `${domain}.intent_pin` }
  async apply(step: Step, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    if (step.parent.kind !== `${this.domain}.intent_draft`) throw new Error('钉点必须归属一个原稿。')
    const record = intentRecord(step.parent), finish = record.host.checkpoint(), refs: ApplicationRef[] = []
    try {
    await record.host.prepare(record.draft)
    if (step.operation.kind === 'create') {
      for (const item of step.operation.items) {
        context.signal?.throwIfAborted()
        const sampleId = z.string().min(1).parse(item.properties[`${this.entityType}.sample_id`])
        if (record.host.read().drafts.find(d => d.id === record.draftId)!.pins.some(p => p.sampleId === sampleId)) throw new Error('这个姿态已经钉住，请使用现有钉点。')
        await record.host.configure({ pinSampleId: sampleId }); record.host.assertCurrent()
        const pin = record.host.read().drafts.find(d => d.id === record.draftId)!.pins.find(p => p.sampleId === sampleId)
        if (!pin) throw new Error('原稿姿态未被钉住，请重新读取原稿。')
        refs.push(intentRef(record.documentRef, 'intent_pin', record.draftId, pin.id))
      }
    } else {
      for (const ref of step.operation.targets) {
        const child = intentRecord(ref)
        if (ref.kind !== this.entityType || child.draftId !== record.draftId || child.documentRef.id !== record.documentRef.id) throw new Error('不能删除另一原稿的钉点。')
        context.signal?.throwIfAborted(); await record.host.configure({ unpinId: child.childId }); refs.push(ref)
      }
    }
    return { ...intentResult(refs, this.domain), undoToken: retainIntentUndo(finish(), refs, this.domain) }
    } catch (error) { if (JSON.stringify(record.host.read()) !== JSON.stringify(record.head)) await finish()(); throw error }
  }
  async undo(token: string) { return undoIntent(token) }
  async compensate(_step: Step, result: ApplicationCompletedStepResult) { if (result.undoToken) await undoIntent(result.undoToken); return [] }
}
