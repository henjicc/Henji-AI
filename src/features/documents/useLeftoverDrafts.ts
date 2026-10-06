import { useCallback, useEffect, useState } from 'react'

import type { DocumentKindId, DocumentSummary, ProjectSummary } from '@/core/documents/types'
import { createLogger } from '@/core/logging/logger'

import { toError } from './documentErrors'
import { getDocumentSessionRegistry, type DocumentSessionRegistry } from './documentSessionRegistry'

/*
 * 意外退出留下的草稿（重要记录 007、012）：项目页把它们排在列表最前、带“草稿”标记。
 * 继续编辑 = 交给页面打开（离开时照常询问保存）；移到回收站 = 文档草稿进回收站 / 草稿项目整个文件夹进回收站。
 * 只列出当前没有打开的草稿；会话登记表变化（打开、保存、关闭）后重读。读取失败只记日志，列表照常可用。
 */

const logger = createLogger('features.documents.recovery')

export interface LeftoverDrafts<T> {
  drafts: T[]
  /** 移到回收站；失败时抛出，由页面显示原因。 */
  discard: (draft: T) => Promise<void>
}

function useLeftover<T extends { id: string }>(
  registry: DocumentSessionRegistry,
  list: () => Promise<T[]>,
  remove: (draft: T) => Promise<void>,
  failureEvent: string,
): LeftoverDrafts<T> {
  const [drafts, setDrafts] = useState<T[]>([])

  const load = useCallback(async (): Promise<void> => {
    try {
      setDrafts(await list())
    } catch (raw) {
      logger.warn('读取遗留草稿失败', { event: failureEvent, error: toError(raw) })
    }
  }, [list, failureEvent])

  useEffect(() => {
    void load()
    return registry.subscribe(() => { void load() })
  }, [registry, load])

  const discard = useCallback(async (draft: T): Promise<void> => {
    await remove(draft)
    setDrafts((current) => current.filter((item) => item.id !== draft.id))
  }, [remove])

  return { drafts, discard }
}

/** 某一类文档的遗留草稿（不限位置）。 */
export function useLeftoverDocumentDrafts(kind: DocumentKindId, provided?: DocumentSessionRegistry): LeftoverDrafts<DocumentSummary> {
  const registry = provided ?? getDocumentSessionRegistry()
  const list = useCallback(() => registry.listLeftoverDrafts({ kind }), [registry, kind])
  const remove = useCallback((draft: DocumentSummary) => registry.discardLeftoverDraft(draft), [registry])
  return useLeftover(registry, list, remove, 'documents.recovery.list.failed')
}

/** 遗留的草稿项目（剪辑页）。 */
export function useLeftoverDraftProjects(provided?: DocumentSessionRegistry): LeftoverDrafts<ProjectSummary> {
  const registry = provided ?? getDocumentSessionRegistry()
  const list = useCallback(() => registry.listLeftoverDraftProjects(), [registry])
  const remove = useCallback((project: ProjectSummary) => registry.discardLeftoverDraftProject(project.id), [registry])
  return useLeftover(registry, list, remove, 'documents.recovery.projects.failed')
}
