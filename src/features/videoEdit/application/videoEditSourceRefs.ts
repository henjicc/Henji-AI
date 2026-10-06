import type { DocumentLink } from '@/core/documents/types'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import { getDocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'

/**
 * 片段来源里的跨文档引用（4.1）：打开着的文档取会话里的当前位置，否则查作品索引。
 * 送结果进剪辑的入口（画布节点、图片文档、口播）都经这里拿 { docId, path }。
 */
export async function videoEditDocumentRef(docId: string): Promise<DocumentLink> {
  const session = getDocumentSessionRegistry().get(docId)
  if (session && !session.isEnded) return { docId, path: session.documentMeta.path }
  const document = await getDocumentOperations().findDocument(docId)
  return { docId, path: document.path }
}
