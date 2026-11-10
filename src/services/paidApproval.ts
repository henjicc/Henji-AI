import i18n from '@/i18n'
import { convertPriceAmount, readPriceEstimateDisplaySettings } from '@/core/pricing/priceDisplay'
import { z } from 'zod'
import { registry } from '@/core/ModelRegistry'
import { estimateGenerationPrice } from '@/features/generation/application/generationPreparationService'
import { getControlledExecutionModel } from '@/core/modelCatalog/controlledExecutionModels'
import type { TranscriptionPreparation } from '@/core/audioEdit/transcriptionFailure'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import { bindPaidOperationReceipt, hasApplicationConfirmation, hasApplicationPaidApproval } from '@/core/application-control/userConfirmation'
import type { PaidApprovalRequest, PaidOperationCategory, PaidFailureFacts } from '@/core/application-control/paidApproval'
import { paidApprovalDecisionSchema, readPaidFailureFacts } from '@/core/application-control/paidApproval'
import { getPlatform } from '@/platform/runtime'
import { rendererEpoch } from '@/features/application-control/rendererIdentity'
import type { LocalHostReply } from '@/core/application-control/localHostContracts'
import type { ApplicationRef } from '@/core/application-control'
import { splitImageEditV3DocumentRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'

type ImageEditDocumentProjectResolver = (documentId: string) => Promise<{ projectId: string } | undefined>
let resolveImageEditDocumentProject: ImageEditDocumentProjectResolver | undefined

/** 画布节点里的图片文档不在文档目录登记，由根应用装配注入它所在的画布工程；付费审批不导入画布实现。 */
export function configurePaidApprovalImageDocumentResolver(resolver: ImageEditDocumentProjectResolver): void { resolveImageEditDocumentProject = resolver }

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
    const target = await resolveImageEditDocumentProject?.(documentId)
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
  const { comparableCnyAmount: estimatedCny } = z.object({ comparableCnyAmount: z.number().nonnegative().nullable() }).parse(await estimateGenerationPrice(model, values))
  const project = projectId ? await getDocumentOperations().findProject(projectId) : undefined
  return prepareUiPaidApproval({ category: 'generation', estimatedCny, ...(project ? { project: { id: project.id, name: project.name } } : {}) }, 'create_visible_generation_task')
}

export async function prepareUiPaidApproval(request: PaidApprovalRequest, capabilityId: NonNullable<LocalHostReply['uiPaidApproval']>['capabilityId']) {
  const requestId = crypto.randomUUID()
  const send = (action: NonNullable<LocalHostReply['uiPaidApproval']>['action'], failureFacts?: PaidFailureFacts) => getPlatform().applicationControl.complete({
    requestId, rendererEpoch, result: {}, uiPaidApproval: { action, request, capabilityId, ...(failureFacts ? { failureFacts } : {}) },
  })
  const decision = paidApprovalDecisionSchema.parse(await send('prepare'))
  return { receipt: { operationId: requestId, callerId: rendererEpoch }, decision, project: request.project,
    start: () => send('start'), complete: () => send('complete'), reject: () => send('reject'), failed: (error?: unknown) => send('failed', readPaidFailureFacts(error)) }
}

export interface PaidOperationOptions {
  category: PaidOperationCategory
  documentId?: string | ApplicationRef
  estimatedCny?: number | null
  generationTaskIds?: string[]
  generationTaskEstimates?: PaidApprovalRequest['generationTaskEstimates']
  titleKey?: string
  messageKey?: string
  capabilityId?: NonNullable<LocalHostReply['uiPaidApproval']>['capabilityId']
}
// Receipts only live for this call. They cannot be supplied by tools or carried to another UI action.
const uiCapabilities = { generation: 'ui_generate_text', recognition: 'transcribe_audio_edit', translation: 'ui_translate_subtitles', title: 'ui_generate_title', explanation: 'interpret_video_edit_intent' } as const

/** 生成提交确认被拒与中途停止：名字跨模块、跨桌面桥都可靠（src/core/nativeErrors.ts） */
const USER_CANCELLATION_NAMES = new Set(['GenerationSubmissionCancelledError', 'AbortError'])

/** 用户主动取消（生成提交被拒、中途停止），沿 cause 链判断；调用方据此记信息日志，不弹错误。 */
export function isUserCancellation(error: unknown): boolean {
  const seen = new Set<Error>()
  while (error instanceof Error && !seen.has(error)) {
    if (USER_CANCELLATION_NAMES.has(error.name)) return true
    seen.add(error); error = error.cause
  }
  return false
}

/** Authorize before dispatch; failure after dispatch retains the reservation as an unknown bill. */
export async function withPaidOperation<T>(options: PaidOperationOptions, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  if (signal && hasApplicationPaidApproval(signal, options.category)) return work(signal)
  const request = await applicationPaidRequest(options.category, options.documentId, signal, options.estimatedCny ?? null)
  if (options.generationTaskIds) request.generationTaskIds = options.generationTaskIds
  if (options.generationTaskEstimates) request.generationTaskEstimates = options.generationTaskEstimates
  if (hasApplicationConfirmation(signal)) {
    const { requestAlertConfirmation } = await import('@/stores/alertDialogStore')
    const title = i18n.t(options.titleKey ?? `paidApproval.categories.${options.category}`, { ns: 'common' })
    const message = i18n.t(options.messageKey ?? 'paidApproval.operationContent', { ns: 'common' })
    await requestAlertConfirmation({ title, message, confirmLabel: i18n.t('paidApproval.allowOnce', { ns: 'common' }), paid: request }, signal)
    signal!.throwIfAborted()
    return work(signal!)
  }
  const paid = await prepareUiPaidApproval(request, options.capabilityId ?? uiCapabilities[options.category])
  const controller = new AbortController()
  const abort = (): void => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  let releaseReceipt: (() => void) | undefined
  let started = false
  let workCompleted = false
  try {
    controller.signal.throwIfAborted()
    await paid.start(); started = true
    releaseReceipt = bindPaidOperationReceipt(controller.signal, paid.receipt, options.category)
    const result = await work(controller.signal)
    workCompleted = true
    await paid.complete()
    return result
  } catch (error) {
    await (started ? paid.failed(workCompleted ? { paidFailureFacts: { billing: 'completed' }, cause: error } : error) : paid.reject())
    throw error
  } finally {
    releaseReceipt?.()
    signal?.removeEventListener('abort', abort)
  }
}

export function transcriptionEstimatedCny(prepared: TranscriptionPreparation): number | null {
  return prepared.cost?.status === 'estimated'
    ? convertPriceAmount(prepared.cost.amount, prepared.cost.currency, 'CNY', readPriceEstimateDisplaySettings().usdToCnyRate) : null
}
