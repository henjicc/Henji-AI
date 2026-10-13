import { notificationMessage } from '@/i18n/notifications'
import i18n from '@/i18n'
import { convertPriceAmount, readPriceEstimateDisplaySettings } from '@/core/pricing/priceDisplay'
import { z } from 'zod'
import { registry } from '@/core/ModelRegistry'
import { createPriceEstimate } from '@/features/generation/application/generationPreparationService'
import { getControlledExecutionModel } from '@/core/modelCatalog/controlledExecutionModels'
import type { TranscriptionPreparation } from '@/core/audioEdit/transcriptionFailure'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import { hasApplicationConfirmation, hasApplicationPaidApproval } from '@/core/application-control/userConfirmation'
import type { PaidApprovalRequest, PaidOperationCategory, PaidFailureFacts } from '@/core/application-control/paidApproval'
import { uiPaidApprovalDecisionSchema, paidApprovalMessage, isPaidConfirmationExpired, readPaidFailureFacts } from '@/core/application-control/paidApproval'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { notifyUser } from '@/contexts/NotificationContext'
import { getPlatform } from '@/platform/runtime'
import { rendererEpoch } from '@/features/application-control/rendererIdentity'
import type { LocalHostReply } from '@/core/application-control/localHostContracts'
import type { ApplicationRef } from '@/core/application-control'
import { splitImageEditV3DocumentRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'

/** Resolve the actual project container; a toolbox document does not grant a fictitious project. */
export async function applicationPaidRequest(category: PaidOperationCategory, documentId: string | ApplicationRef | undefined, signal?: AbortSignal, estimatedCny: number | null = null): Promise<PaidApprovalRequest> {
  signal?.throwIfAborted()
  return paidRequestForDocument(category, documentId, estimatedCny)
}
async function paidRequestForDocument(category: PaidOperationCategory, documentRef?: string | ApplicationRef, estimatedCny: number | null = null): Promise<PaidApprovalRequest> {
  if (!documentRef) return { category, estimatedCny }
  const operations = getDocumentOperations()
  const imageRef = typeof documentRef !== 'string' && documentRef.kind === 'image_edit.document'
  const documentId = imageRef ? splitImageEditV3DocumentRef(documentRef).documentId : typeof documentRef === 'string' ? documentRef : documentRef.id
  let document
  try { document = await operations.findDocument(documentId) } catch (error) {
    if (!imageRef || !(error instanceof Error) || error.name !== 'DocumentNotFoundError') throw error
    const { findCanvasImageEditDocumentTarget } = await import('@/features/canvas/application/imageEditDocumentProjectionBinding')
    const target = await findCanvasImageEditDocumentTarget(documentId)
    if (!target) return { category, estimatedCny }
    document = await operations.findDocument(target.projectId)
  }
  if (document.container.kind !== 'project') return { category, estimatedCny }
  const project = await operations.findProject(document.container.projectId)
  return { category, estimatedCny, project: { id: project.id, name: project.name } }
}

export async function prepareExplanationPaidApproval(documentRef: { kind: string; id: string }) {
  const request = await paidRequestForDocument('explanation', documentRef)
  const capabilityId = documentRef.kind === 'video_edit.document' ? 'interpret_video_edit_intent' : 'interpret_image_edit_intent'
  return prepareUiPaidApproval(request, capabilityId)
}

export async function prepareGenerationPaidApproval(modelId: string, params: DynamicValueMap, projectId?: string) {
  const model = registry.getModel(modelId) ?? getControlledExecutionModel(modelId)
  if (!model) throw new Error('所选生成模型不可用。')
  const values = { ...Object.fromEntries(model.params.map(param => [param.id, param.default])), ...params }
  const { comparableCnyAmount: estimatedCny } = z.object({ comparableCnyAmount: z.number().nonnegative().nullable() }).parse(createPriceEstimate(model, values))
  const project = projectId ? await getDocumentOperations().findProject(projectId) : undefined
  return prepareUiPaidApproval({ category: 'generation', estimatedCny, ...(project ? { project: { id: project.id, name: project.name } } : {}) }, 'create_visible_generation_task')
}

export async function prepareUiPaidApproval(request: PaidApprovalRequest, capabilityId: NonNullable<LocalHostReply['uiPaidApproval']>['capabilityId']) {
  const requestId = crypto.randomUUID()
  const send = (action: NonNullable<LocalHostReply['uiPaidApproval']>['action'], projectConsent?: boolean, failureFacts?: PaidFailureFacts) => getPlatform().applicationControl.complete({
    requestId, rendererEpoch, result: {}, uiPaidApproval: { action, request, capabilityId, projectConsent, ...(failureFacts ? { failureFacts } : {}) },
  })
  const decision = uiPaidApprovalDecisionSchema.parse(await send('prepare'))
  return { decision, project: request.project, confirm: async (project: boolean) => {
    try { return await send('approve', project) }
    catch (error) {
      if (isPaidConfirmationExpired(error)) throw new PaidOperationCancelledError(error)
      throw error
    }
  }, start: async () => {
    await send('start')
    if (decision.decision === 'auto') notifyUser(decision.estimatedCny === null ? notificationMessage('autoApprovedMetered') : notificationMessage('autoApprovedEstimate', { amount: decision.estimatedCny.toFixed(2) }))
  }, complete: () => send('complete'), reject: () => send('reject'), failed: (error?: unknown) => send('failed', undefined, readPaidFailureFacts(error)) }
}

export interface PaidOperationOptions {
  category: PaidOperationCategory
  documentId?: string | ApplicationRef
  estimatedCny?: number | null
  titleKey?: string
  messageKey?: string
  capabilityId?: NonNullable<LocalHostReply['uiPaidApproval']>['capabilityId']
}
// Receipts only live for this call. They cannot be supplied by tools or carried to another UI action.
const activeApprovals = new WeakMap<AbortSignal, PaidOperationCategory>()
const uiCapabilities = { generation: 'ui_generate_text', recognition: 'transcribe_audio_edit', translation: 'ui_translate_subtitles', title: 'ui_generate_title', explanation: 'interpret_video_edit_intent' } as const

export class PaidOperationCancelledError extends ApplicationPreflightFailure {}
export function isPaidOperationCancelled(error: unknown): boolean {
  const seen = new Set<Error>()
  while (error instanceof Error && !seen.has(error)) {
    if (error instanceof PaidOperationCancelledError) return true
    seen.add(error); error = error.cause
  }
  return false
}

/** Authorize before dispatch; failure after dispatch retains the reservation as an unknown bill. */
export async function withPaidOperation<T>(options: PaidOperationOptions, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  if (signal && (activeApprovals.get(signal) === options.category || hasApplicationPaidApproval(signal, options.category))) return work(signal)
  const request = await applicationPaidRequest(options.category, options.documentId, signal, options.estimatedCny ?? null)
  const { requestAlertConfirmation } = await import('@/stores/alertDialogStore')
  const title = i18n.t(options.titleKey ?? `paidApproval.categories.${options.category}`, { ns: 'common' })
  const message = i18n.t(options.messageKey ?? 'paidApproval.operationContent', { ns: 'common' })
  if (hasApplicationConfirmation(signal)) {
    await requestAlertConfirmation({ title, message, confirmLabel: i18n.t('paidApproval.allowOnce', { ns: 'common' }), paid: request }, signal)
    signal!.throwIfAborted()
    return work(signal!)
  }
  const paid = await prepareUiPaidApproval(request, options.capabilityId ?? uiCapabilities[options.category])
  const controller = new AbortController()
  const abort = (): void => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  let started = false
  let workCompleted = false
  try {
    controller.signal.throwIfAborted()
    if (paid.decision.decision === 'deny') throw new ApplicationPreflightFailure(paid.decision.reason)
    if (paid.decision.decision === 'ask') {
      let project = false
      const accepted = await requestAlertConfirmation({ title, message, paidDetails: paidApprovalMessage(paid.decision, options.category), confirmLabel: i18n.t('paidApproval.allowOnce', { ns: 'common' }),
        paidConfirmation: true, projectConfirmation: !!paid.project, onProject: () => { project = true } }, controller.signal)
      if (!accepted) throw new PaidOperationCancelledError('已取消，未执行本次操作，也未提交付费请求。')
      controller.signal.throwIfAborted()
      await paid.confirm(project)
    }
    controller.signal.throwIfAborted()
    await paid.start(); started = true
    activeApprovals.set(controller.signal, options.category)
    const result = await work(controller.signal)
    workCompleted = true
    await paid.complete()
    return result
  } catch (error) {
    await (started ? paid.failed(workCompleted ? { paidFailureFacts: { billing: 'completed' }, cause: error } : error) : paid.reject())
    throw error
  } finally {
    activeApprovals.delete(controller.signal)
    signal?.removeEventListener('abort', abort)
  }
}

export function transcriptionEstimatedCny(prepared: TranscriptionPreparation): number | null {
  return prepared.cost?.status === 'estimated'
    ? convertPriceAmount(prepared.cost.amount, prepared.cost.currency, 'CNY', readPriceEstimateDisplaySettings().usdToCnyRate) : null
}
