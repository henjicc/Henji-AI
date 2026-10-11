import { CREATIVE_INTENT_CAPABILITIES } from '@/core/application-control/domains/creativeIntent/creativeIntentCapabilities'
import { reviewSemanticIntent } from '@/core/creativeIntent/semanticIntent'
import { semanticRecordingInput, semanticRecordingResolutions } from '@/core/creativeIntent/semanticIntentRecording'
import { creativeIntentRegistration } from './creativeIntentReflection'
import { CreativeIntentMutationExecutor } from './creativeIntentMutationExecutors'
import { CreativeIntentPinCollectionExecutor, CreativeIntentEvidenceCollectionExecutor } from './creativeIntentCollectionExecutor'
import { INTENT_ENTITIES, intentRecord, intentHost, intentRef, intentRevisions, intentProvider, type IntentDomain } from './creativeIntentHost'
import type { ApplicationDomainModule } from './domainModule'
import type { ApplicationRef } from '@/core/application-control'
import type { CapabilityExecutionContext } from './capabilities/handlerTypes'
import type { ExplanationSession } from '@/core/creativeIntent/schema'
import { createLogger } from '@/core/logging'
import { semanticVisualBatches, type SemanticIntentImage } from '@/core/creativeIntent/semanticIntentInput'
import { prepareSemanticImage } from './creativeIntentImages'
import { assertApplicationCallerGrant } from '@/core/application-control/callerContext'
import { creativeExplanationRegistration, CreativeExplanationMutationExecutor } from './creativeIntentExplanation'
const logger = createLogger('features.applicationControl.creativeIntent')
type InputProgress = { baseline: string; offset: number; imageOffset: number; receipt?: string }
const inputReads = new WeakMap<object, Map<string, InputProgress>>()
function recordingReads(owner: object) {
  let reads = inputReads.get(owner)
  if (!reads) { reads = new Map(); inputReads.set(owner, reads) }
  return reads
}
const recordingKey = (documentRef: ApplicationRef, sessionId: string, context: CapabilityExecutionContext) => JSON.stringify([context.callerGrant?.callerId ?? 'renderer', documentRef, sessionId])

function recordingSource(documentRef: ApplicationRef, sessionId: string, context: CapabilityExecutionContext) {
  const host = intentHost(documentRef), session = host.read().sessions.find(s => s.id === sessionId)
  if (!session) throw new Error('讲解记录不存在，请重新读取原文档。')
  if (!session.consent?.textUpload) throw new Error('PERMISSION_DENIED:请先在录制宿主确认讲解文字外发。')
  const baseline = JSON.stringify(session)
  const assertCurrent = () => {
    if (context.callerGrant) assertApplicationCallerGrant(context.callerGrant)
    context.signal.throwIfAborted(); host.assertCurrent()
    if (JSON.stringify(host.read().sessions.find(s => s.id === sessionId)) !== baseline) throw new Error('讲解已删除或校正，请重新读取；不会发送旧记录。')
  }
  const read = async (resourceId: string): Promise<unknown> => {
    assertCurrent()
    const resource = host.read().resources.find(r => r.resourceId === resourceId)
    if (!resource || resource.kind !== 'page') throw new Error('讲解页已不存在；不会读取原音或其他资源。')
    const result = await intentProvider(documentRef.kind.split('.')[0] as IntentDomain).readResource(resource)
    assertCurrent(); return result
  }
  return { host, session: structuredClone(session) as ExplanationSession, read, assertCurrent }
}

export const creativeIntentApplicationDomain: ApplicationDomainModule = {
  id: 'creativeIntent',
  entities: () => (['video_edit', 'image_edit'] as const).flatMap(domain => [...INTENT_ENTITIES.map(type => creativeIntentRegistration(domain, type)), creativeExplanationRegistration(domain)]),
  registerExecutors(engine) {
    for (const domain of ['video_edit', 'image_edit'] as const) {
      engine.registerMutationExecutor(new CreativeExplanationMutationExecutor(domain))
      for (const type of INTENT_ENTITIES) if (type !== 'intent_pin' && !(domain === 'image_edit' && type === 'intent_take')) engine.registerMutationExecutor(new CreativeIntentMutationExecutor(domain, type))
      engine.registerCollectionExecutor(new CreativeIntentPinCollectionExecutor(domain))
      engine.registerCollectionExecutor(new CreativeIntentEvidenceCollectionExecutor(domain, 'intent_draft'))
      if (domain === 'video_edit') engine.registerCollectionExecutor(new CreativeIntentEvidenceCollectionExecutor(domain, 'intent_take'))
    }
  },
  registerCapabilities(registrar) {
    for (const definition of CREATIVE_INTENT_CAPABILITIES) registrar.registerHandler(definition.id, async (raw, context) => {
      const input = definition.inputSchema.parse(raw)
      const domain = definition.domain as IntentDomain
      logger.info('意图处理开始', { event: 'creative_intent.process.start', requestId: context.requestId, capabilityId: definition.id })
      try {
        if ('documentRef' in input) {
          const source = recordingSource(input.documentRef, input.sessionId, context)
          const reads = recordingReads(source.host.owner)
          const key = recordingKey(input.documentRef, input.sessionId, context), baseline = JSON.stringify(source.session)
          if (input.offset === 0 && input.imageOffset === 0) reads.set(key, { baseline, offset: 0, imageOffset: 0 })
          const progress = reads.get(key)
          if (!progress || progress.baseline !== baseline || progress.offset !== input.offset || progress.imageOffset !== input.imageOffset) throw new Error('讲解批次不连续或已变化，请从 offset=0 重新读取。')
          const lines: string[] = []; let offset = 0; let nextOffset: number | null = null; let textSize = 0
          // 128 lines is an output batch budget, never a recording or product count limit.
          for await (const line of semanticRecordingInput(source.session, source.read, source.host.size())) {
            source.assertCurrent()
            if (offset++ < input.offset) continue
            if (lines.length === 128 || lines.length && textSize + line.length > 24_000) { nextOffset = offset - 1; break }
            lines.push(line); textSize += line.length
          }
          const semanticImages: SemanticIntentImage[] = []
          let nextImageOffset: number | null = input.imageOffset
          if (nextOffset === null) {
            const resolutions = await semanticRecordingResolutions(source.session, source.read)
            const batches = semanticVisualBatches(source.session, resolutions)
            const batch = batches[input.imageOffset]
            if (batch) {
              if (!source.session.consent?.imageUpload) throw new Error('PERMISSION_DENIED:本段讲解需要历史画面，请先确认图片外发或手动绑定对象。')
              const provider = intentProvider(domain)
              if (!provider.readVisual) throw new Error('历史画面不可用，请手动确认指代。')
              for (const visual of batch) {
                source.assertCurrent()
                const resource = source.host.read().resources.find(r => r.kind === 'visual' && r.resourceId === visual.resourceRef.resourceId && r.digest === visual.resourceRef.digest && r.bytes === visual.resourceRef.bytes)
                if (!resource) throw new Error('历史画面缺失，请手动确认；不会使用当前画面替代。')
                semanticImages.push(await prepareSemanticImage(await provider.readVisual(resource), visual))
              }
            }
            nextImageOffset = input.imageOffset + 1 < batches.length ? input.imageOffset + 1 : null
          }
          source.assertCurrent()
          progress.offset = nextOffset ?? input.offset; progress.imageOffset = nextImageOffset ?? input.imageOffset
          if (nextOffset === null && nextImageOffset === null) progress.receipt = crypto.randomUUID()
          logger.info('讲解文字批次已读取', { event: 'creative_intent.process.completed', requestId: context.requestId })
          return { resultRef: input.documentRef, lines, nextOffset, nextImageOffset, semanticImages, inputReceipt: progress.receipt, revision: intentRevisions(domain)[domain], scopeRevisions: intentRevisions(domain) }
        }
        const record = intentRecord(input.draftRef)
        let status: 'candidate' | 'confirmation_required' | 'local_fallback' = 'candidate'; let questions: string[] = []
        const finish = () => ({ resultRef: input.draftRef, candidateRefs: record.host.read().drafts.find(d => d.id === record.draftId)!.candidateRefs.map(c => intentRef(record.documentRef, 'intent_candidate', record.draftId, c.resourceId)), status, questions, revision: intentRevisions(domain)[domain], scopeRevisions: intentRevisions(domain) })
        let review
        if ('semanticPlan' in input) {
          if (!('sessionId' in input) || typeof input.sessionId !== 'string' || !input.sessionId) throw new Error('语义计划需要已授权的原讲解 sessionId；不能伪造绑定或否定保护。')
          const source = recordingSource(record.documentRef, input.sessionId, context)
          const reads = recordingReads(source.host.owner)
          const progress = reads.get(recordingKey(record.documentRef, input.sessionId, context))
          if (!progress?.receipt || progress.receipt !== ('inputReceipt' in input ? input.inputReceipt : undefined) || progress.baseline !== JSON.stringify(source.session)) throw new Error('请完整读取当前讲解与必要附图，再提交意图；不能省略未处理指代。')
          const resolutions = await semanticRecordingResolutions(source.session, source.read); source.assertCurrent()
          reads.delete(recordingKey(record.documentRef, input.sessionId, context))
          review = reviewSemanticIntent(input.semanticPlan, record.draft, resolutions)
          status = review.status; questions = review.questions
          if (review.protectedRefs.length) { status = 'confirmation_required'; questions.push('请先核对并钉住否定保护的对象，再重新整理；不会修改受保护对象。') }
          if (status === 'confirmation_required') return finish()
        }
        const originalHead = structuredClone(record.host.read())
        await record.host.prepare(record.draft); context.signal.throwIfAborted()
        try {
        if (review?.plan) {
          const actions = review.plan.actions
          if (domain === 'video_edit' && actions.length === 1 && actions[0].kind === 'motion') await intentProvider(domain).configureMotion!(record.documentRef.id, { intent: actions[0].intent, selectedTakeIds: [actions[0].takeId] })
          else if (domain === 'image_edit' && actions.every(a => a.kind === 'layout')) {
            const head = structuredClone(record.host.read()), draft = head.drafts.find(d => d.id === record.draftId)!
            draft.constraints = [...draft.constraints, ...actions.filter(a => a.kind === 'layout').map(a => a.constraint)]
            draft.candidateRefs = []; delete draft.selectedCandidateRef
            draft.sourceDigest = await intentProvider(domain).digest({ pages: draft.takes.flatMap(t => t.samplePages), recipes: draft.recipeRefs, pins: draft.pins, constraints: draft.constraints, fidelity: draft.fidelity })
            record.host.assertCurrent(); record.host.commit(head); await record.host.prepare(draft)
          } else { status = 'local_fallback'; questions.push('此组合尚不能由当前宿主编译，使用本地整理。') }
        }
        await record.host.optimize(context.signal)
        }
        catch (error) {
          context.signal.throwIfAborted(); record.host.assertCurrent()
          if (!review?.plan) throw error
          record.host.commit(originalHead); await record.host.prepare(record.draft)
          status = 'local_fallback'; questions.push('语义候选无法编译，已恢复原稿并使用本地整理。')
          await record.host.optimize(context.signal)
        }
        context.signal.throwIfAborted(); record.host.assertCurrent()
        if (context.callerGrant) assertApplicationCallerGrant(context.callerGrant)
        await record.host.save()
        logger.info('意图候选处理完成', { event: 'creative_intent.process.completed', requestId: context.requestId, context: { status } })
        return finish()
      } catch (error) { logger.warn('意图处理未完成', { event: 'creative_intent.process.failed', requestId: context.requestId, error }); throw error }
    })
  },
}
