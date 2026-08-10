import { afterEach, describe, expect, it } from 'vitest'

import { createEmptyImageEditDocument, createImageEditOperation, getImageEditOperation } from '@/core/imageEdit'

import { useImageEditSessionStore } from './imageEditSessionStore'

const CUSTOM_OPERATION_ID = 'image.diffusion'

function resetStore(): void {
  useImageEditSessionStore.setState({ sessions: {} })
}

function hasCustomOperation(sessionId: string): boolean {
  const document = useImageEditSessionStore.getState().sessions[sessionId]?.document
  return Boolean(document && getImageEditOperation(document, CUSTOM_OPERATION_ID));
}

describe('imageEditSessionStore（6.1：多实例隔离）', () => {
  afterEach(() => {
    resetStore()
  })

  it('两个 sessionId 的文档互不影响', () => {
    const store = useImageEditSessionStore.getState()
    store.ensureSession('session-a')
    store.ensureSession('session-b')

    const docA = createEmptyImageEditDocument()
    docA.operations.push(createImageEditOperation(CUSTOM_OPERATION_ID, {}))
    useImageEditSessionStore.getState().commitDocument('session-a', docA)

    // session-b 完全没碰过，不应该出现 session-a 才写入的那个自定义操作
    expect(hasCustomOperation('session-a')).toBe(true)
    expect(hasCustomOperation('session-b')).toBe(false)
  })

  it('对一个 session 撤销/重做不影响另一个 session 的历史栈', () => {
    const store = useImageEditSessionStore.getState()
    store.ensureSession('session-a')
    store.ensureSession('session-b')

    const docA1 = createEmptyImageEditDocument()
    docA1.operations.push(createImageEditOperation(CUSTOM_OPERATION_ID, {}))
    useImageEditSessionStore.getState().commitDocument('session-a', docA1)

    const docB1 = createEmptyImageEditDocument()
    docB1.operations.push(createImageEditOperation(CUSTOM_OPERATION_ID, {}))
    useImageEditSessionStore.getState().commitDocument('session-b', docB1)

    expect(useImageEditSessionStore.getState().sessions['session-a'].undoStack).toHaveLength(1)
    expect(useImageEditSessionStore.getState().sessions['session-b'].undoStack).toHaveLength(1)

    useImageEditSessionStore.getState().undo('session-a')

    // session-a 撤销后自定义操作消失，session-b 完全没被这次撤销影响
    expect(hasCustomOperation('session-a')).toBe(false)
    expect(hasCustomOperation('session-b')).toBe(true)
    expect(useImageEditSessionStore.getState().sessions['session-b'].undoStack).toHaveLength(1)
  })

  it('disposeSession 只清理指定会话，其余会话保留', () => {
    const store = useImageEditSessionStore.getState()
    store.ensureSession('session-a')
    store.ensureSession('session-b')

    useImageEditSessionStore.getState().disposeSession('session-a')

    const sessions = useImageEditSessionStore.getState().sessions
    expect(sessions['session-a']).toBeUndefined()
    expect(sessions['session-b']).toBeDefined()
  })

  it('ensureSession 对已存在的会话是幂等的（不覆盖已有内容）', () => {
    const store = useImageEditSessionStore.getState()
    store.ensureSession('session-a')

    const doc = createEmptyImageEditDocument()
    doc.operations.push(createImageEditOperation(CUSTOM_OPERATION_ID, {}))
    useImageEditSessionStore.getState().commitDocument('session-a', doc)

    // 重复调用 ensureSession（模拟 StrictMode 下的双重挂载），不应该把已提交的内容重置回空文档
    useImageEditSessionStore.getState().ensureSession('session-a')

    expect(hasCustomOperation('session-a')).toBe(true)
  })

  it('redo 在撤销之后能拿回原文档，且不影响其他会话', () => {
    const store = useImageEditSessionStore.getState()
    store.ensureSession('session-a')
    store.ensureSession('session-b')

    const doc = createEmptyImageEditDocument()
    doc.operations.push(createImageEditOperation(CUSTOM_OPERATION_ID, {}))
    useImageEditSessionStore.getState().commitDocument('session-a', doc)
    useImageEditSessionStore.getState().undo('session-a')
    useImageEditSessionStore.getState().redo('session-a')

    expect(hasCustomOperation('session-a')).toBe(true)
    expect(hasCustomOperation('session-b')).toBe(false)
  })
})
