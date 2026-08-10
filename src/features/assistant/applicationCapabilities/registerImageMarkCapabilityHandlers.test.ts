// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { createEmptyImageEditDocument, createImageEditOperation, IMAGE_EDIT_OPERATION_IDS } from '@/core/imageEdit'
import { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore'

import type { CapabilityHandler } from './handlerTypes'
import { registerImageMarkCapabilityHandlers } from './registerImageMarkCapabilityHandlers'

const context = { signal: new AbortController().signal }

function registeredHandlers(): Map<string, CapabilityHandler> {
  const handlers = new Map<string, CapabilityHandler>()
  registerImageMarkCapabilityHandlers({
    registerHandler: (id, handler) => handlers.set(id, handler),
  })
  return handlers
}

describe('registerImageMarkCapabilityHandlers（6.2）', () => {
  afterEach(() => {
    useImageEditSessionStore.setState({ sessions: {} })
  })

  it('撤销/重做直接驱动 imageEditSessionStore 的 undo/redo 栈', async () => {
    useImageEditSessionStore.getState().ensureSession('session-handler', createEmptyImageEditDocument())
    const before = useImageEditSessionStore.getState().sessions['session-handler'].document
    const next = createImageEditOperation(IMAGE_EDIT_OPERATION_IDS.crop, { rect: { x: 0, y: 0, width: 5, height: 5 } })
    useImageEditSessionStore.getState().commitDocument('session-handler', { ...before, operations: [...before.operations, next] })

    const handlers = registeredHandlers()
    const undoResult = await handlers.get('undo_image_mark_change')?.({ sessionId: 'session-handler' }, context)
    expect(undoResult).toEqual({ sessionId: 'session-handler', status: 'undone' })
    expect(useImageEditSessionStore.getState().sessions['session-handler'].document).toEqual(before)

    const redoResult = await handlers.get('redo_image_mark_change')?.({ sessionId: 'session-handler' }, context)
    expect(redoResult).toEqual({ sessionId: 'session-handler', status: 'redone' })
    expect(useImageEditSessionStore.getState().sessions['session-handler'].document.operations).toContainEqual(next)
  })

  it('没有可撤销/重做的操作时抛出 CONFLICT', async () => {
    useImageEditSessionStore.getState().ensureSession('session-empty', createEmptyImageEditDocument())
    const handlers = registeredHandlers()
    expect(() => handlers.get('undo_image_mark_change')?.({ sessionId: 'session-empty' }, context))
      .toThrow('CONFLICT')
    expect(() => handlers.get('redo_image_mark_change')?.({ sessionId: 'session-empty' }, context))
      .toThrow('CONFLICT')
  })
})
