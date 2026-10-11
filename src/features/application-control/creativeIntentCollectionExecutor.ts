import { z } from 'zod'
import type { ApplicationCollectionExecutor, ApplicationCompletedStepResult, ApplicationExecutionContext, ApplicationPlannedStep, ApplicationRef } from '@/core/application-control'
import { intentRecord, intentRef, intentHost, intentProvider, type IntentDomain } from './creativeIntentHost'
import { applicationRefSchema } from '@/core/application-control/identifiers'
import { motionDraftSchema, refKey } from '@/core/creativeIntent/contracts'
import { creativeIntentPageSchema } from '@/core/creativeIntent/pages'
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
        await record.host.configure({ pinSampleId: sampleId }, context); record.host.assertCurrent()
        const pin = record.host.read().drafts.find(d => d.id === record.draftId)!.pins.find(p => p.sampleId === sampleId)
        if (!pin) throw new Error('原稿姿态未被钉住，请重新读取原稿。')
        refs.push(intentRef(record.documentRef, 'intent_pin', record.draftId, pin.id))
      }
    } else {
      for (const ref of step.operation.targets) {
        const child = intentRecord(ref)
        if (ref.kind !== this.entityType || child.draftId !== record.draftId || child.documentRef.id !== record.documentRef.id) throw new Error('不能删除另一原稿的钉点。')
        context.signal?.throwIfAborted(); await record.host.configure({ unpinId: child.childId }, context); refs.push(ref)
      }
    }
    return { ...intentResult(refs, this.domain), undoToken: retainIntentUndo(finish(), refs, this.domain) }
    } catch (error) { if (JSON.stringify(record.host.read()) !== JSON.stringify(record.head)) await finish()(); throw error }
  }
  async undo(token: string) { return undoIntent(token) }
  async compensate(_step: Step, result: ApplicationCompletedStepResult) { if (result.undoToken) await undoIntent(result.undoToken); return [] }
}

/** Reuses verified immutable evidence; collection inputs cannot fabricate recordings or pins. */
export class CreativeIntentEvidenceCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType: string
  readonly effectContract = { direct: [], cascades: [] }
  constructor(readonly domain: IntentDomain, readonly type: 'intent_draft' | 'intent_take') { this.entityType = `${domain}.${type}` }
  async apply(step: Step, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const parent = this.type === 'intent_take' ? intentRecord(step.parent) : undefined
    if (step.parent.kind !== `${this.domain}.${this.type === 'intent_draft' ? 'document' : 'intent_draft'}`) throw new Error('原稿集合的父引用不匹配。')
    const host = parent?.host ?? intentHost(step.parent), before = host.read(), finish = host.checkpoint(), head = structuredClone(before)
    const refs: ApplicationRef[] = []
    let committed = false
    try {
      if (step.operation.kind === 'create') for (const item of step.operation.items) {
        context.signal?.throwIfAborted()
        const sourceRef = applicationRefSchema.parse(item.properties[`${this.entityType}.source_ref`]), source = intentRecord(sourceRef)
        if (sourceRef.kind !== this.entityType || refKey(source.documentRef) !== refKey(host.documentRef)) throw new Error('只能复用同一文档中已验证的原稿或示范。')
        if (this.type === 'intent_draft') {
          const draft = motionDraftSchema.parse({ ...structuredClone(source.draft), id: crypto.randomUUID(), candidateRefs: [], selectedCandidateRef: undefined, applications: [],
            label: item.properties[`${this.entityType}.label`] ?? source.draft.label })
          head.drafts.push(draft); refs.push(intentRef(host.documentRef, this.type, draft.id))
        } else {
          const draft = head.drafts.find(d => d.id === parent!.draftId)!, take = source.draft.takes.find(t => t.id === source.childId)!
          if (JSON.stringify(draft.targets) !== JSON.stringify(source.draft.targets) || JSON.stringify(draft.clockSegments) !== JSON.stringify(source.draft.clockSegments)) throw new Error('示范的目标基态或时钟不同，请重新采集；不能混用证据。')
          if (draft.takes.some(t => t.id === take.id)) throw new Error('原稿已经包含这段示范。')
          draft.takes.push(structuredClone(take)); refs.push(intentRef(host.documentRef, this.type, draft.id, take.id))
        }
      }
      else for (const ref of step.operation.targets) {
        context.signal?.throwIfAborted()
        const record = intentRecord(ref)
        if (ref.kind !== this.entityType || refKey(record.documentRef) !== refKey(host.documentRef) || parent && record.draftId !== parent.draftId) throw new Error('不能删除另一文档或原稿中的成员。')
        if (this.type === 'intent_draft') {
          head.drafts = head.drafts.filter(d => d.id !== record.draftId)
          if (head.motionOptions) head.motionOptions = head.motionOptions.filter(o => o.draftId !== record.draftId)
        } else {
          const draft = head.drafts.find(d => d.id === record.draftId)!, take = draft.takes.find(t => t.id === record.childId)!
          const removed = new Set<string>()
          for (const page of take.samplePages) {
            const resource = head.resources.find(r => r.resourceId === page.resourceId)
            if (!resource) throw new Error('原稿采样资源缺失，请恢复原文件。')
            const value = creativeIntentPageSchema.parse(await intentProvider(this.domain).readResource(resource))
            if (value.kind !== 'samples') throw new Error('示范资源类型无效。')
            value.entries.forEach(sample => removed.add(sample.sampleId))
          }
          draft.takes = draft.takes.filter(t => t.id !== take.id)
          draft.pins = draft.pins.filter(pin => !removed.has(pin.sampleId))
          const options = head.motionOptions?.find(o => o.draftId === draft.id)
          if (options?.selectedTakeIds) options.selectedTakeIds = options.selectedTakeIds.filter(id => id !== take.id)
        }
        refs.push(ref)
      }
      if (parent) {
        const draft = head.drafts.find(d => d.id === parent.draftId)!
        draft.candidateRefs = []; delete draft.selectedCandidateRef
        draft.sourceDigest = await intentProvider(this.domain).digest({ takes: draft.takes, pins: draft.pins, constraints: draft.constraints, fidelity: draft.fidelity })
      }
      context.signal?.throwIfAborted(); host.assertCurrent()
      if (host.read() !== before) throw new Error('原稿在读取期间变化，请重新规划。')
      host.commit(head); committed = true
      return { ...intentResult(refs, this.domain), undoToken: retainIntentUndo(finish(), refs, this.domain) }
    } catch (error) { if (committed) await finish()(); throw error }
  }
  async undo(token: string) { return undoIntent(token) }
  async compensate(_step: Step, result: ApplicationCompletedStepResult) { if (result.undoToken) await undoIntent(result.undoToken); return [] }
}
