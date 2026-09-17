import { retryImageEditDocumentSaveV3 } from '@/features/imageEdit/v3/application/imageEditPersistenceOperations'
import { splitImageEditV3DocumentRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'
import type { ApplicationRef } from '@/core/application-control/applicationCapabilities'

import { commitImageEdit } from '@/features/imageEdit/application/imageEditApplicationService'

import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'
import { createImageEditPreviewFromRef } from '@/features/imageEdit/application/imageSourceCapabilityService'
import { parseCapabilityInput, throwIfCapabilityAborted } from '@/features/application-control/capabilities/handlerUtils'

export function registerImageEditCapabilityHandlers(registrar: ApplicationCapabilityHandlerRegistrar): void {
  registrar.registerHandler('create_image_edit_preview', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      sourceRef: ApplicationRef
      operations: Record<string, unknown>[]
    }>('create_image_edit_preview', input)
    const preview = await createImageEditPreviewFromRef({
      sourceRef: parsed.sourceRef,
      operations: parsed.operations,
    })
    const previewRef = String(preview.previewRef)
    return {
      previewRef,
      sourceRef: parsed.sourceRef,
      resultRefs: preview.resultRefs,
      operationCount: preview.operationCount,
      hasEffect: preview.hasEffect,
      width: preview.width,
      height: preview.height,
    }
  })

  registrar.registerHandler('commit_image_edit', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      previewRef: string
      displayName?: string
    }>('commit_image_edit', input)
    return await commitImageEdit(parsed.previewRef, parsed.displayName)
  })

  registrar.registerHandler('retry_image_edit_document_save', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const { documentRef, expectedOwnerId } = parseCapabilityInput<{ documentRef: { kind: 'image_edit.document'; id: string }; expectedOwnerId?: string }>(
      'retry_image_edit_document_save', input)
    const saved = await retryImageEditDocumentSaveV3(splitImageEditV3DocumentRef(documentRef).documentId, expectedOwnerId)
    return { ref: documentRef, status: 'persisted', effects: saved.receipt?.effects ?? [],
      resultingRevisions: saved.receipt?.resultingRevisions ?? {} }
  })

}
