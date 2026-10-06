import { createLogger } from '@/core/logging'
import { saveDocumentCover } from '@/commands/documents'
import type { DocumentCoverSource, DocumentKindId, DocumentReadResult } from '@/core/documents/types'
import { getDocumentOperations } from './documentOperations'

/*
 * 通用文档封面的“从内容补生成”：列表里没有封面的文档（草稿意外退出前没写过封面、换了作品目录、
 * 旧文件等），按类型登记的取法从文档内容算出封面来源，交主进程渲染成通用封面。
 *
 * 各工具只登记“内容 → 封面来源”这一步（与打开方式一起登记），列表页与项目页统一调用，
 * 不在页面里写某个工具的分支。编辑器打开期间的封面更新仍由各工具自己负责（取的是实时画面）。
 */

export type DocumentCoverProvider = (read: DocumentReadResult) => DocumentCoverSource[] | null

const logger = createLogger('features.documents.covers')
const providers = new Map<DocumentKindId, DocumentCoverProvider>()
const attempted = new Set<string>()
const listeners = new Set<(docId: string) => void>()

/** 登记某类文档从内容取封面来源的方式；返回注销函数。 */
export function registerDocumentCoverProvider(kind: DocumentKindId, provider: DocumentCoverProvider): () => void {
  providers.set(kind, provider)
  return () => { if (providers.get(kind) === provider) providers.delete(kind) }
}

export function hasDocumentCoverProvider(kind: DocumentKindId): boolean {
  return providers.has(kind)
}

/** 封面写好后通知（列表据此重读）。 */
export function subscribeDocumentCoverChanged(listener: (docId: string) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function notifyDocumentCoverChanged(docId: string): void {
  for (const listener of [...listeners]) listener(docId)
}

/**
 * 没有封面时从内容补生成一次（每份文档每次运行只试一次）；没有可用画面、读不出或渲染失败时保持占位图，只记日志。
 */
export async function ensureDocumentCover(docId: string, kind: DocumentKindId): Promise<void> {
  const provider = providers.get(kind)
  if (!provider || attempted.has(docId)) return
  attempted.add(docId)
  try {
    const read = await getDocumentOperations().readDocument({ id: docId })
    const sources = provider(read)
    if (!sources?.length) return
    await saveDocumentCover({ docId, sources: sources.slice(0, 4) })
    notifyDocumentCoverChanged(docId)
  } catch (error) {
    logger.warn('补生成文档封面失败', { event: 'documents.cover.ensure_failed', context: { docId, kind }, error: String(error) })
  }
}
