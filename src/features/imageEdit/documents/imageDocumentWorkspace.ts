import { useSyncExternalStore } from 'react'

import type { DocumentTarget } from '@/core/documents/types'

/*
 * 工具箱图片编辑页显示哪份图片文档（3.5）：
 * - current：编辑器正在显示的文档 ID。切到别的工作区再回来时继续显示它（会话一直开着），
 *   离开（返回列表、切换）后清空。应用重启后回到列表，不再自动恢复“上一张”。
 * - pending：别处（文档列表右键打开、助手 open_document、其他工具传图）请求打开的文档，
 *   由图片编辑页接手：先离开当前文档（草稿三选一），再打开。
 * 只是界面导航状态，不进持久化。
 */

export interface ImageDocumentWorkspaceState {
  current: string | null
  pending: { key: number; target: DocumentTarget } | null
}

let state: ImageDocumentWorkspaceState = { current: null, pending: null }
let nextKey = 1
const listeners = new Set<() => void>()

function set(next: Partial<ImageDocumentWorkspaceState>): void {
  state = { ...state, ...next }
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getImageDocumentWorkspace(): ImageDocumentWorkspaceState {
  return state
}

export function useImageDocumentWorkspace(): ImageDocumentWorkspaceState {
  return useSyncExternalStore(subscribe, getImageDocumentWorkspace, getImageDocumentWorkspace)
}

export function setCurrentImageDocument(id: string | null): void {
  if (state.current !== id) set({ current: id })
}

/** 请图片编辑页打开这份文档（页面挂载后接手）。 */
export function requestImageDocumentInEditor(target: DocumentTarget): void {
  set({ pending: { key: nextKey++, target: { id: target.id, ...(target.path ? { path: target.path } : {}) } } })
}

export function takePendingImageDocument(key: number): void {
  if (state.pending?.key === key) set({ pending: null })
}

export function resetImageDocumentWorkspaceForTests(): void {
  state = { current: null, pending: null }
}
