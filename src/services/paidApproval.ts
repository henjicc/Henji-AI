import { convertPriceAmount, readPriceEstimateDisplaySettings } from '@/core/pricing/priceDisplay'
import type { TranscriptionPreparation } from '@/core/audioEdit/transcriptionFailure'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import { hasApplicationConfirmation } from '@/core/application-control/userConfirmation'
import type { PaidApprovalRequest, PaidOperationCategory } from '@/core/application-control/paidApproval'
import { paidApprovalDecisionSchema } from '@/core/application-control/paidApproval'
import { getPlatform } from '@/platform/runtime'
import { rendererEpoch } from '@/features/application-control/rendererIdentity'
import type { LocalHostReply } from '@/core/application-control/localHostContracts'
import type { ApplicationRef } from '@/core/application-control'
import { splitImageEditV3DocumentRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'

/** Resolve the actual project container; a toolbox document does not grant a fictitious project. */
export async function applicationPaidRequest(category: PaidOperationCategory, documentId: string | ApplicationRef | undefined, signal?: AbortSignal, estimatedCny: number | null = null): Promise<PaidApprovalRequest | undefined> {
  if (!hasApplicationConfirmation(signal)) return undefined
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
  const requestId = crypto.randomUUID()
  const capabilityId = documentRef.kind === 'video_edit.document' ? 'interpret_video_edit_intent' : 'interpret_image_edit_intent'
  const send = (action: NonNullable<LocalHostReply['uiPaidApproval']>['action'], projectConsent?: boolean) => getPlatform().applicationControl.complete({
    requestId, rendererEpoch, result: {}, uiPaidApproval: { action, request, capabilityId, projectConsent },
  })
  const decision = paidApprovalDecisionSchema.parse(await send('prepare'))
  return { decision, project: request.project, confirm: (project: boolean) => send('approve', project), start: () => send('start'), complete: () => send('complete'), reject: () => send('reject'), failed: () => send('failed') }
}

export function transcriptionEstimatedCny(prepared: TranscriptionPreparation): number | null {
  return prepared.cost?.status === 'estimated'
    ? convertPriceAmount(prepared.cost.amount, prepared.cost.currency, 'CNY', readPriceEstimateDisplaySettings().usdToCnyRate) : null
}
