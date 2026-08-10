import { create } from 'zustand'

import { createEmptyImageEditDocument, type ImageEditDocument } from '@/core/imageEdit'
import { HISTORY_LIMIT } from '@/features/imageMark/editor/shared'

/*
 * 图片编辑会话的全局 store（6.1），按 sessionId 分片——统一图片编辑器
 * （工具箱 / 画布 Viewer / 画布编辑工具三个宿主，都通过
 * src/features/imageEdit/editor/ImageEditor.tsx 渲染）明确会同时存在多个实例
 * （比如画布上开着 Viewer 的同时，工具箱里也打开了编辑器），不能做成单例 draft。
 *
 * 这里只管 document 本身与撤销/重做栈；`useImageEditorSession.ts` 里的
 * transactionBaseRef（柔光滑杆拖拽时的"这次拖动只留一条历史记录"临时态）留在
 * hook 里不搬——它是纯粹的交互态，不需要跨组件寻址，搬进 store 反而多一层无意义的
 * 间接。
 *
 * reducer 逻辑全部复用 @/core/imageEdit/document.ts 里已经是纯函数的
 * replaceMarkDocInImageEditDocument/upsertImageEditOperation 等——那些函数早就不
 * import React，本任务不重写它们，只是把"谁来持有当前 document"从组件级 useState
 * 换成这个 store。
 */
interface ImageEditSessionRecord {
  document: ImageEditDocument
  undoStack: ImageEditDocument[]
  redoStack: ImageEditDocument[]
}

interface ImageEditSessionStoreState {
  sessions: Record<string, ImageEditSessionRecord>
  /** 幂等：会话已存在时不覆盖，供 StrictMode 下的重复挂载安全调用。 */
  ensureSession: (sessionId: string, initialDocument?: ImageEditDocument) => void
  disposeSession: (sessionId: string) => void
  pushHistorySnapshot: (sessionId: string, base: ImageEditDocument) => void
  commitDocument: (sessionId: string, next: ImageEditDocument, recordHistory?: boolean) => void
  updateDocumentWithoutHistory: (sessionId: string, next: ImageEditDocument) => void
  undo: (sessionId: string) => ImageEditDocument | null
  redo: (sessionId: string) => ImageEditDocument | null
}

function requireSession(
  sessions: Record<string, ImageEditSessionRecord>,
  sessionId: string,
): ImageEditSessionRecord {
  return sessions[sessionId] ?? { document: createEmptyImageEditDocument(), undoStack: [], redoStack: [] }
}

export const useImageEditSessionStore = create<ImageEditSessionStoreState>((set, get) => ({
  sessions: {},

  ensureSession: (sessionId, initialDocument) => set((state) => {
    if (state.sessions[sessionId]) return state
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: { document: initialDocument ?? createEmptyImageEditDocument(), undoStack: [], redoStack: [] },
      },
    }
  }),

  disposeSession: (sessionId) => set((state) => {
    if (!(sessionId in state.sessions)) return state
    const { [sessionId]: _removed, ...rest } = state.sessions
    return { sessions: rest }
  }),

  pushHistorySnapshot: (sessionId, base) => set((state) => {
    const session = requireSession(state.sessions, sessionId)
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          undoStack: [...session.undoStack, base].slice(-HISTORY_LIMIT),
          redoStack: [],
        },
      },
    }
  }),

  commitDocument: (sessionId, next, recordHistory = true) => set((state) => {
    const session = requireSession(state.sessions, sessionId)
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          document: next,
          undoStack: recordHistory ? [...session.undoStack, session.document].slice(-HISTORY_LIMIT) : session.undoStack,
          redoStack: recordHistory ? [] : session.redoStack,
        },
      },
    }
  }),

  updateDocumentWithoutHistory: (sessionId, next) => set((state) => {
    const session = requireSession(state.sessions, sessionId)
    return { sessions: { ...state.sessions, [sessionId]: { ...session, document: next } } }
  }),

  undo: (sessionId) => {
    const session = get().sessions[sessionId]
    const previous = session?.undoStack[session.undoStack.length - 1]
    if (!session || !previous) return null
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          document: previous,
          undoStack: session.undoStack.slice(0, -1),
          redoStack: [...session.redoStack, session.document].slice(-HISTORY_LIMIT),
        },
      },
    }))
    return previous
  },

  redo: (sessionId) => {
    const session = get().sessions[sessionId]
    const next = session?.redoStack[session.redoStack.length - 1]
    if (!session || !next) return null
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          document: next,
          redoStack: session.redoStack.slice(0, -1),
          undoStack: [...session.undoStack, session.document].slice(-HISTORY_LIMIT),
        },
      },
    }))
    return next
  },
}))
