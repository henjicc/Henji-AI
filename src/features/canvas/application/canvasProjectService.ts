import type { DocumentSummary, DocumentTarget } from '@/core/documents/types'
import { useProjectStore } from '@/stores/projectStore'

import type { ProjectSummary } from './canvasDocumentContent'
import { canvasDocumentCommands } from './canvasDocumentEnvironment'
import { listCanvasProjectInstances, releaseCanvasProjectInstance } from './canvasProjectInstances'

/*
 * 画布文档的界面与能力入口（3.4）：画布的列出、新建、改名、移动、副本、回收站都由通用文档能力承担，
 * 这里只剩“打开到画布页”“后台释放”与反射用的画布目录。
 */

/**
 * 反射与能力用的画布目录：已保存的画布 + 已经打开的草稿。
 * 没打开的草稿不列（读它会打开会话，页面的“遗留草稿”区就看不到它了）。
 */
export async function listCanvasDocumentSummaries(): Promise<ProjectSummary[]> {
  const documents = await canvasDocumentCommands().listDocuments({
    kind: 'canvas', container: { kind: 'any' }, includeDrafts: true, includeMissing: false,
  })
  const open = new Map(listCanvasProjectInstances().filter((instance) => !instance.session.isEnded).map((instance) => [instance.id, instance]))
  return documents
    .filter((document) => !document.draft || open.has(document.id))
    .map((document) => {
      const instance = open.get(document.id)
      const snapshot = instance?.snapshot()
      return {
        id: document.id,
        name: snapshot?.name ?? document.name,
        createdAt: document.createdAt,
        updatedAt: snapshot?.updatedAt ?? document.updatedAt,
        nodeCount: snapshot?.nodeCount ?? Number(document.summary.nodes ?? 0),
        coverPath: null,
      }
    })
}

/** 打开一份画布到画布页；离开当前画布被取消时返回 false。 */
export async function openCanvasDocument(target: DocumentTarget | DocumentSummary): Promise<boolean> {
  return await useProjectStore.getState().openCanvasDocument({ id: target.id, ...(target.path ? { path: target.path } : {}) })
}

/** 通用文档操作移到回收站前的后台释放（界面正在显示、有进行中的任务时拒绝）。 */
export async function releaseCanvasDocument(id: string): Promise<boolean> {
  return await releaseCanvasProjectInstance(id)
}
