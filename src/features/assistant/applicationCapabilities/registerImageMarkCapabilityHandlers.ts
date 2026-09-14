import { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore'

import type { ApplicationCapabilityHandlerRegistrar } from './handlerTypes'
import { parseCapabilityInput, throwIfCapabilityAborted } from './handlerUtils'
import { retryImageEditDocumentSaveV3 } from '@/features/imageEdit/v3/application/imageEditPersistenceOperations'
import { splitImageEditV3DocumentRef } from '@/features/imageEdit/v3/application/imageEditLiveSessionRegistry'

export function registerImageMarkCapabilityHandlers(
  registrar: ApplicationCapabilityHandlerRegistrar
): void {
  registrar.registerHandler('retry_image_edit_document_save', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const { documentRef, expectedOwnerId } = parseCapabilityInput<{ documentRef: { kind: 'image_edit.document'; id: string }; expectedOwnerId?: string }>(
      'retry_image_edit_document_save', input)
    const saved = await retryImageEditDocumentSaveV3(splitImageEditV3DocumentRef(documentRef).documentId, expectedOwnerId)
    return { ref: documentRef, status: 'persisted', effects: saved.receipt?.effects ?? [],
      resultingRevisions: saved.receipt?.resultingRevisions ?? {} }
  })
  registrar.registerHandler('undo_image_mark_change', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ sessionId: string }>('undo_image_mark_change', input)
    if (!useImageEditSessionStore.getState().undo(parsed.sessionId)) {
      throw new Error('CONFLICT：当前标注编辑会话没有可撤销操作。')
    }
    return { sessionId: parsed.sessionId, status: 'undone' }
  })

  registrar.registerHandler('redo_image_mark_change', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ sessionId: string }>('redo_image_mark_change', input)
    if (!useImageEditSessionStore.getState().redo(parsed.sessionId)) {
      throw new Error('CONFLICT：当前标注编辑会话没有可重做操作。')
    }
    return { sessionId: parsed.sessionId, status: 'redone' }
  })
}
