import { useCallback, useSyncExternalStore } from 'react'

import { createLogger } from '@/core/logging/logger'

import type { DocumentLeaveOutcome } from './documentSessionTypes'

/*
 * 嵌入模式（4.1）：从剪辑里新建或打开的画布、口播、镜头参考、图片文档记住“从哪里来”。
 * 这些工具的命令带左端据此把“返回列表”换成“返回剪辑 · 项目名”：先走该工具自己的离开流程
 * （已保存的写完关闭，草稿按“保存 / 不保存 / 取消”），没有取消就回到剪辑原来的位置（剪辑工作区切走不卸载）。
 *
 * 只是界面导航的记忆：按文档 ID 记在内存里，应用重启后不保留；从通用入口正常打开同一份文档时清掉。
 * 不用 zustand（不是业务状态，也不向助手开放），页面经 useSyncExternalStore 订阅。
 */

export interface EmbeddedHost {
  /** 返回按钮上显示的去处名称（剪辑所在项目的名称）。 */
  label: string
  /** 回到宿主（打开剪辑工作区并显示原来的剪辑）。 */
  returnToHost(): Promise<void>
}

const logger = createLogger('features.documents.embedded')
const hosts = new Map<string, EmbeddedHost>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 标记一份文档是从宿主（剪辑）里打开的；host 为 null 时清除。 */
export function setEmbeddedHost(documentId: string, host: EmbeddedHost | null): void {
  if (host) hosts.set(documentId, host)
  else if (!hosts.delete(documentId)) return
  emit()
}

export function getEmbeddedHost(documentId: string | null | undefined): EmbeddedHost | null {
  return documentId ? hosts.get(documentId) ?? null : null
}

/**
 * 嵌入模式的返回：先走工具自己的离开流程，没有取消就清掉标记并回到宿主。
 * 返回 false 表示用户在离开提示里选了取消，仍留在原处。
 */
export async function returnFromEmbedded(documentId: string, leave: () => Promise<DocumentLeaveOutcome>): Promise<boolean> {
  const host = hosts.get(documentId)
  const outcome = await leave()
  if (outcome === 'cancelled') return false
  setEmbeddedHost(documentId, null)
  if (host) {
    await host.returnToHost()
    logger.info('已从嵌入的文档返回剪辑', { event: 'documents.embedded.returned', context: { documentId, outcome } })
  }
  return true
}

/** 页面订阅：这份文档是否在嵌入模式里打开，以及返回动作。 */
export function useEmbeddedHost(documentId: string | null | undefined): EmbeddedHost | null {
  const read = useCallback(() => getEmbeddedHost(documentId), [documentId])
  return useSyncExternalStore(subscribe, read, read)
}

/** 仅供测试：清空全部标记。 */
export function resetEmbeddedHostsForTests(): void {
  hosts.clear()
  emit()
}
