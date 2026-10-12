import { prepareExplanationPaidApproval } from '@/services/paidApproval'
import { paidApprovalMessage } from '@/core/application-control/paidApproval'
import type { ApplicationRef } from '@/core/application-control'
import type { ExplanationSession } from '@/core/creativeIntent/schema'
import type { MotionDraft } from '@/core/creativeIntent/contracts'
import { semanticRecordingResolutions } from '@/core/creativeIntent/semanticIntentRecording'
import { semanticVisualBatches } from '@/core/creativeIntent/semanticIntentInput'
import { getPlatform } from '@/platform/runtime'
import type { EmbeddedIntentRequest } from '@/core/assistant/embeddedAgent'

export interface ExplanationSendRequest {
  modelName: string; imageCount: number; costMessage: string; hasProject: boolean
  cancel(): Promise<void>
  confirm(project: boolean): Promise<void>
}
export interface ExplanationGenerationHost {
  documentRef: ApplicationRef
  session(): ExplanationSession | undefined
  drafts(): readonly MotionDraft[]
  read(resourceId: string): Promise<unknown>
  consent(value: NonNullable<ExplanationSession['consent']>): Promise<void>
  assertCurrent(): void
}
export interface PreparedExplanationGeneration {
  request?: ExplanationSendRequest
  run(local: () => Promise<void>): Promise<void>
  cancel(): Promise<void>
}
/** Preflight never sends private data; the official Pi reads it through the authorized public tools. */
export async function prepareExplanationGeneration(host: ExplanationGenerationHost): Promise<PreparedExplanationGeneration> {
  const session = host.session()
  const local: PreparedExplanationGeneration = { run: work => work(), cancel: async () => {} }
  if (!session?.pages.some(page => page.kind === 'transcript')) return local
  const platform = getPlatform().embeddedAgent
  const model = (await platform.models())[0]
  if (!model) return local
  if ((await platform.snapshot()).busy) throw new Error('请等待当前 AI 回复结束。')
  const resolutions = await semanticRecordingResolutions(session, host.read)
  const imageCount = semanticVisualBatches(session, resolutions).flat().length
  if (imageCount && !model.inputModalities.includes('image')) return local
  const identity = (value: ExplanationSession): string => JSON.stringify({ ...value, consent: undefined })
  const baseline = identity(session)
  const assertCurrent = (): ExplanationSession => {
    host.assertCurrent()
    const current = host.session()
    if (!current || current.id !== session.id || identity(current) !== baseline) throw new Error('讲解已变化，请重新生成候选。')
    return current
  }
  assertCurrent()
  const paid = await prepareExplanationPaidApproval(host.documentRef)
  let authorized = paid.decision.decision === 'auto'
  let consumed = false, started = false
  const cancel = async () => { if (!consumed) { consumed = true; await paid.reject() } }
  try { assertCurrent() } catch (error) { await cancel(); throw error }
  const request: ExplanationSendRequest | undefined = authorized ? undefined : {
    modelName: model.name, imageCount, costMessage: paidApprovalMessage(paid.decision), hasProject: !!paid.project,
    cancel,
    confirm: async project => {
      const current = assertCurrent()
      if (!current.consent) throw new Error('讲解授权信息缺失，请重新打开讲解。')
      await paid.confirm(project)
      authorized = true
    },
  }
  return { request, cancel, run: async work => {
    if (consumed) throw new Error('本次生成已执行，请重新整理。')
    if (!authorized) throw new Error('请先确认发送讲解。')
    consumed = true
    try {
      const approved = assertCurrent()
      {
        if (!approved.consent) throw new Error('讲解授权信息缺失，请重新打开讲解。')
        await host.consent({ ...approved.consent, textUpload: true, imageUpload: imageCount > 0, userReceiptRef: crypto.randomUUID() })
      }
      // Preserve a deterministic candidate before Pi; model failures never remove the local result.
      const beforeDrafts = new Map(host.drafts().map(draft => [draft.id, JSON.stringify(draft)]))
      await work()
      host.assertCurrent()
      const current = host.session()
      if (!current || current.id !== session.id || !current.consent?.textUpload) throw new Error('讲解外发授权已变化。')
      const domain = host.documentRef.kind.split('.')[0]
      const changed = host.drafts().filter(draft => beforeDrafts.get(draft.id) !== JSON.stringify(draft))
      const drafts = changed.length ? changed : host.drafts().slice(-1)
      if (!drafts.length) throw new Error('请先录制动作或摆放图层。')
      const creativeIntent: EmbeddedIntentRequest = { documentRef: host.documentRef as EmbeddedIntentRequest['documentRef'], sessionId: session.id,
        draftRefs: drafts.map(draft => ({ kind: `${domain}.intent_draft` as EmbeddedIntentRequest['draftRefs'][number]['kind'], id: `${host.documentRef.id}:${encodeURIComponent(draft.id)}` })) }
      await paid.start(); started = true
      await new Promise<void>((resolve, reject) => {
        let started = false
        const release = platform.onSnapshot(state => {
          if (state.busy) started = true
          if (started && !state.busy && !state.pendingMessages?.length) { release(); if (state.error) reject(new Error(state.error)); else resolve() }
        })
        void platform.prompt({ text: '根据指定讲解整理候选。完整读取讲解文字和必要画面，核对原稿后提交封闭语义计划。只生成候选，不应用作品，不修改其他内容。',
          context: JSON.stringify({ creativeIntent }), creativeIntent, model: { providerId: model.providerId, modelId: model.modelId }, access: 'write', clientMessageId: crypto.randomUUID() }).catch(error => { release(); reject(error) })
      })
      await paid.complete()
    } catch (error) {
      if (started) await paid.failed()
      else await paid.reject()
      throw error
    } finally {
      const current = host.session()
      if (current?.id === session.id && current.consent) await host.consent({ ...current.consent, textUpload: false, imageUpload: false })
    }
  } }
}
