import { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore'

import type { ApplicationCapabilityHandlerRegistrar } from './handlerTypes'
import { parseCapabilityInput, throwIfCapabilityAborted } from './handlerUtils'

export function registerImageMarkCapabilityHandlers(
  registrar: ApplicationCapabilityHandlerRegistrar
): void {
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
