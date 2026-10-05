import { create } from 'zustand'

import type {
  DocumentConflictChoice,
  DocumentConflictPromptInfo,
  DocumentLeaveChoice,
  DocumentLeavePromptInfo,
  DocumentSaveNamePromptInfo,
  DocumentSessionPrompter,
} from './documentSessionTypes'

/*
 * 会话需要用户决定的提示排成队列，由根层的 DocumentSessionDialogs 逐个渲染。
 * 会话逻辑不依赖 React：它只调用 prompter，拿到用户的选择。
 */

export type DocumentPromptRequest =
  | { key: number; type: 'leave'; info: DocumentLeavePromptInfo; resolve: (choice: DocumentLeaveChoice) => void }
  | { key: number; type: 'saveName'; info: DocumentSaveNamePromptInfo; resolve: (saved: boolean) => void }
  | { key: number; type: 'conflict'; info: DocumentConflictPromptInfo; resolve: (choice: DocumentConflictChoice) => void }

interface DocumentPromptState {
  queue: DocumentPromptRequest[]
}

export const useDocumentPromptStore = create<DocumentPromptState>(() => ({ queue: [] }))

let nextKey = 1

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

function enqueue<T>(build: (finish: (value: T) => void, key: number) => DocumentPromptRequest): Promise<T> {
  return new Promise<T>((resolve) => {
    const key = nextKey++
    let settled = false
    const finish = (value: T): void => {
      if (settled) return
      settled = true
      useDocumentPromptStore.setState((state) => ({ queue: state.queue.filter((item) => item.key !== key) }))
      resolve(value)
    }
    const request = build(finish, key)
    useDocumentPromptStore.setState((state) => ({ queue: [...state.queue, request] }))
  })
}

function push<T>(request: DistributiveOmit<DocumentPromptRequest, 'key' | 'resolve'>): Promise<T> {
  return enqueue<T>((finish, key) => ({ ...request, key, resolve: finish } as DocumentPromptRequest))
}

/** 默认提示实现：排进队列，由 DocumentSessionDialogs 渲染。 */
export const dialogDocumentSessionPrompter: DocumentSessionPrompter = {
  chooseLeaveAction: (info) => push<DocumentLeaveChoice>({ type: 'leave', info }),
  askSaveName: (info) => push<boolean>({ type: 'saveName', info }),
  resolveConflict: (info) => push<DocumentConflictChoice>({ type: 'conflict', info }),
}
