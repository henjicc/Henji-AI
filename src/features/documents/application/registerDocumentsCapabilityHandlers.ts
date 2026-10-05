import type { z } from 'zod'

import {
  DOCUMENT_ENTITY_TYPE,
  DOCUMENT_PROJECT_ENTITY_TYPE,
  type documentListItemSchema,
  type projectListItemSchema,
} from '@/core/application-control/domains/documents/documentsApplicationCapabilities'
import type { DocumentContainerRef, DocumentSummary, ProjectSummary } from '@/core/documents/types'
import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'
import { parseCapabilityInput, throwIfCapabilityAborted } from '@/features/application-control/capabilities/handlerUtils'

import { toError } from '../documentErrors'
import { getDocumentOperations, isDocumentNameConflict, type DocumentOperations } from '../documentOperations'

/*
 * 通用文档与项目能力的处理器（存储底座 2.5）：全部委托通用文档操作服务，与项目页右键同一条路。
 * 输出只给稳定引用与名称，不给文件路径。重名失败改写成可自我修正的说法（点名 onConflict / 换名）。
 */

type DocumentListItem = z.infer<typeof documentListItemSchema>
type ProjectListItem = z.infer<typeof projectListItemSchema>

function documentRef(id: string): { kind: typeof DOCUMENT_ENTITY_TYPE; id: string } {
  return { kind: DOCUMENT_ENTITY_TYPE, id }
}

function toDocumentItem(document: DocumentSummary): DocumentListItem {
  return {
    ref: documentRef(document.id),
    name: document.name,
    kind: document.kind,
    projectId: document.container.kind === 'project' ? document.container.projectId : null,
    projectName: document.projectName,
    draft: document.draft,
    missing: document.missing,
    external: document.external,
    updatedAt: document.updatedAt,
  }
}

function toProjectItem(project: ProjectSummary): ProjectListItem {
  return {
    ref: { kind: DOCUMENT_PROJECT_ENTITY_TYPE, id: project.id },
    name: project.name,
    draft: project.draft,
    external: project.external,
    missing: project.missing,
    documentCount: project.documentCount,
  }
}

/**
 * 写入后的核实回执（3.2 补齐 2.5）：从作品索引回读确认结果。公共操作协调器只在 verification.verified 为真时
 * 把操作记为已核实；缺了它，外部智能体看到的永远是“已执行但未核实”，等同失败。
 */
async function verifyDocument(
  operations: DocumentOperations,
  id: string,
  condition: string,
  matches: (document: DocumentSummary) => boolean,
): Promise<{ verified: boolean; condition: string; target: { kind: typeof DOCUMENT_ENTITY_TYPE; id: string } }> {
  const found = await operations.findDocument(id).catch(() => null)
  return { verified: Boolean(found && !found.missing && matches(found)), condition, target: documentRef(id) }
}

/** 重名失败改成带改道办法的错误；其余原样抛出。 */
function rethrowWithRecovery(error: unknown, hint: string): never {
  if (isDocumentNameConflict(error)) throw new Error(`NAME_CONFLICT:${toError(error).message} ${hint}`)
  throw error
}

export function registerDocumentsCapabilityHandlers(
  registrar: ApplicationCapabilityHandlerRegistrar,
  operations: () => DocumentOperations = getDocumentOperations,
): void {
  registrar.registerHandler('list_documents', async (raw) => {
    const input = parseCapabilityInput<{ kind?: DocumentSummary['kind']; location: 'any' | 'standalone' | 'project'; projectId?: string; drafts: 'include' | 'exclude' | 'only'; limit: number }>('list_documents', raw)
    if (input.location === 'project' && !input.projectId) throw new Error('INVALID_INPUT:location=project 时需要 projectId（来自 list_projects）。')
    const container = input.location === 'project' && input.projectId
      ? { kind: 'project' as const, projectId: input.projectId }
      : input.location === 'standalone' ? { kind: 'user' as const } : { kind: 'any' as const }
    const listed = (await operations().listDocuments({
      ...(input.kind ? { kind: input.kind } : {}),
      container,
      includeDrafts: input.drafts !== 'exclude',
      includeMissing: true,
    })).filter((document) => input.drafts !== 'only' || document.draft)
    return { documents: listed.slice(0, input.limit).map(toDocumentItem), total: listed.length }
  })

  registrar.registerHandler('list_projects', async (raw) => {
    const input = parseCapabilityInput<{ includeDrafts: boolean }>('list_projects', raw)
    const projects = await operations().listProjects({ includeDrafts: input.includeDrafts, includeMissing: true })
    return { projects: projects.map(toProjectItem) }
  })

  registrar.registerHandler('create_document', async (raw, context) => {
    throwIfCapabilityAborted(context.signal)
    const input = parseCapabilityInput<{ kind: DocumentSummary['kind']; name: string; projectId?: string }>('create_document', raw)
    const container: DocumentContainerRef = input.projectId ? { kind: 'project', projectId: input.projectId } : { kind: 'user' }
    try {
      const meta = await operations().createDocument({ kind: input.kind, container, name: input.name })
      const verification = await verifyDocument(operations(), meta.id, '新建的文档已从作品索引回读确认（类型、名称、所在项目一致，不是草稿）',
        (document) => document.kind === meta.kind && document.name === meta.name && !document.draft
          && JSON.stringify(document.container) === JSON.stringify(meta.container))
      return { resultRef: documentRef(meta.id), name: meta.name, kind: meta.kind, projectId: meta.container.kind === 'project' ? meta.container.projectId : null, verification }
    } catch (error) {
      rethrowWithRecovery(error, '请换一个名称后重试。')
    }
  })

  registrar.registerHandler('open_document', async (raw, context) => {
    throwIfCapabilityAborted(context.signal)
    const input = parseCapabilityInput<{ documentId: string }>('open_document', raw)
    const document = await operations().findDocument(input.documentId)
    await operations().openDocument(document)
    // 打开方式（各工具登记）只有在编辑器载入并切换界面后才返回
    const verification = { verified: true, condition: '文档已由对应工具载入并切换到它的编辑器', target: documentRef(document.id) }
    return { resultRef: documentRef(document.id), name: document.name, kind: document.kind, verification }
  })

  registrar.registerHandler('move_document', async (raw, context) => {
    throwIfCapabilityAborted(context.signal)
    const input = parseCapabilityInput<{ documentId: string; projectId: string | null; onConflict: 'fail' | 'keepBoth' }>('move_document', raw)
    const document = await operations().findDocument(input.documentId)
    const container: DocumentContainerRef = input.projectId ? { kind: 'project', projectId: input.projectId } : { kind: 'user' }
    try {
      const result = await operations().moveDocument({ id: document.id, path: document.path }, container, input.onConflict)
      const verification = await verifyDocument(operations(), result.meta.id, '移动后的文档已从作品索引回读确认（所在项目一致）',
        (moved) => JSON.stringify(moved.container) === JSON.stringify(container))
      return {
        resultRef: documentRef(result.meta.id),
        name: result.meta.name,
        projectId: result.meta.container.kind === 'project' ? result.meta.container.projectId : null,
        copiedFiles: result.copiedFiles,
        verification,
      }
    } catch (error) {
      rethrowWithRecovery(error, '如要两个都保留，用 onConflict="keepBoth" 重试；或先改名再移动。')
    }
  })

  registrar.registerHandler('duplicate_document', async (raw, context) => {
    throwIfCapabilityAborted(context.signal)
    const input = parseCapabilityInput<{ documentId: string }>('duplicate_document', raw)
    const document = await operations().findDocument(input.documentId)
    const result = await operations().duplicateDocument({ id: document.id, path: document.path }, 'keepBoth')
    const verification = await verifyDocument(operations(), result.meta.id, '副本已从作品索引回读确认（新 ID、同类型）',
      (copy) => copy.id !== document.id && copy.kind === document.kind)
    return { resultRef: documentRef(result.meta.id), name: result.meta.name, sourceRef: documentRef(document.id), verification }
  })

  registrar.registerHandler('trash_document', async (raw, context) => {
    throwIfCapabilityAborted(context.signal)
    const input = parseCapabilityInput<{ documentId: string }>('trash_document', raw)
    const document = await operations().findDocument(input.documentId)
    await operations().trashDocument({ id: document.id, path: document.path, name: document.name })
    const gone = await operations().findDocument(document.id).then(() => false, () => true)
    const verification = { verified: gone, condition: '文档已从作品索引移除（文件在系统回收站）', target: documentRef(document.id) }
    return { resultRef: documentRef(document.id), name: document.name, status: 'trashed' as const, verification }
  })

  registrar.registerHandler('create_project', async (raw, context) => {
    throwIfCapabilityAborted(context.signal)
    const input = parseCapabilityInput<{ name: string }>('create_project', raw)
    try {
      const project = await operations().createProject(input.name)
      const found = await operations().findProject(project.id).catch(() => null)
      const target = { kind: DOCUMENT_PROJECT_ENTITY_TYPE, id: project.id }
      const verification = { verified: Boolean(found && found.name === project.name && !found.draft), condition: '新建的项目已从作品索引回读确认', target }
      return { resultRef: target, name: project.name, verification }
    } catch (error) {
      rethrowWithRecovery(error, '请换一个名称后重试。')
    }
  })
}
