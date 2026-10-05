import { listImageEditorV3Documents } from '@/commands/imageEditorV3'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import type { ApplicationRef, ApplicationEntityListRequest, ApplicationEntityListResult } from '@/core/application-control'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { getImageEditDocumentCatalogRevisionV3, listImageEditDocumentInstancesV3, isImageEditDocumentRetiredV3 } from './imageEditDocumentInstances'
import { ensureImageEditDocumentInstanceV3 } from './imageEditDocumentLoading'
import { imageEditV3DocumentRef } from './imageEditDocumentRefs'

/** 聚合现有实体来源时传递分页，不先读取十万条实体再截取当前页。 */
export async function listImageEditEntitySources(
  request: ApplicationEntityListRequest,
  sources: readonly ((page: ApplicationEntityListRequest) => Promise<ApplicationEntityListResult>)[],
): Promise<ApplicationEntityListResult> {
  if (!Number.isSafeInteger(request.limit) || request.limit < 1) throw new Error('INVALID_INPUT:实体目录页大小无效')
  const decoded: unknown = request.cursor ? JSON.parse(request.cursor) : [0, null]
  if (!Array.isArray(decoded) || decoded.length !== 2 || !Number.isSafeInteger(decoded[0])
    || decoded[0] < 0 || decoded[0] >= sources.length || (decoded[1] !== null && typeof decoded[1] !== 'string')) throw new Error('INVALID_INPUT:实体目录游标无效')
  let [index, cursor] = decoded as [number, string | null]
  const refs: ApplicationRef[] = []
  const revisions: Record<string, number> = {}
  while (index < sources.length && refs.length < request.limit) {
    const page = await sources[index]({ limit: request.limit - refs.length, ...(cursor === null ? {} : { cursor }) })
    refs.push(...page.refs)
    for (const [scope, revision] of Object.entries(page.revisions)) revisions[scope] = Math.max(revisions[scope] ?? 0, revision)
    if (page.nextCursor !== null) return { refs, revisions, nextCursor: JSON.stringify([index, page.nextCursor]) }
    index++
    cursor = null
  }
  return { refs, revisions, nextCursor: index < sources.length ? JSON.stringify([index, null]) : null }
}

/**
 * 图片编辑文档目录（3.5）：
 * - 图片文档（.henjiimg，含项目里的与草稿）按作品索引列出，ID 即文档 ID（也是它工作副本的 ID）；
 * - 画布多图层节点等内嵌的 V3 文档仍在程序目录仓库里（3.4 迁走之前），主进程列出时已去掉图片文档的工作副本，
 *   已删除图片文档留下的工作副本因此不会再出现；
 * - 加上当前已载入的实例。
 */
async function documentIds(): Promise<string[]> {
  const ids = new Set(listImageEditDocumentInstancesV3().map((instance) => instance.documentId))
  const documents = await getDocumentOperations().listDocuments({
    kind: 'image_document', container: { kind: 'any' }, includeDrafts: true, includeMissing: false,
  })
  for (const document of documents) ids.add(document.id)
  let cursor: string | undefined
  do {
    const page = await listImageEditorV3Documents({ requestId: `image-edit-catalog:${crypto.randomUUID()}`, cursor, limit: 100 })
    for (const ref of page.documentRefs) ids.add(ref.slice('image-edit-v3:'.length))
    if (page.nextCursor !== null && page.nextCursor === cursor) throw new Error('图片文档目录分页未前进')
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return [...ids].filter((id) => !isImageEditDocumentRetiredV3(id)).sort()
}

/** 文档目录无需打开页面；子实体按文档依次读取，到当前页满即停止。 */
export async function listImageEditDocumentEntitiesV3(
  request: ApplicationEntityListRequest,
  children?: (document: ImageEditDocumentV3) => ApplicationRef[],
): Promise<ApplicationEntityListResult> {
  if (!Number.isSafeInteger(request.limit) || request.limit < 1) throw new Error('INVALID_INPUT:图片文档目录页大小无效')
  const refs: ApplicationRef[] = []
  const decoded: unknown = request.cursor ? JSON.parse(request.cursor) : ['', '']
  if (!Array.isArray(decoded) || decoded.length !== 2 || decoded.some((value) => typeof value !== 'string')) throw new Error('INVALID_INPUT:图片文档目录游标无效')
  const [afterDocument, afterRef] = decoded as [string, string]
  let lastCursor: string | null = null
  for (const documentId of await documentIds()) {
    if (documentId < afterDocument) continue
    const documentRef = imageEditV3DocumentRef(documentId)
    const items = children
      ? children((await ensureImageEditDocumentInstanceV3(documentId)).bus.getSnapshot().document)
      : [documentRef]
    for (const ref of items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      if (documentId === afterDocument && ref.id <= afterRef) continue
      if (refs.length === request.limit) return { refs, nextCursor: lastCursor,
        revisions: { image_edit: getImageEditDocumentCatalogRevisionV3() } }
      refs.push(ref)
      lastCursor = JSON.stringify([documentId, ref.id])
    }
  }
  return { refs, nextCursor: null, revisions: { image_edit: getImageEditDocumentCatalogRevisionV3() } }
}
