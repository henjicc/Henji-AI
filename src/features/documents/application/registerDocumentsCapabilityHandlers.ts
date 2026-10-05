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
      return { resultRef: documentRef(meta.id), name: meta.name, kind: meta.kind, projectId: meta.container.kind === 'project' ? meta.container.projectId : null }
    } catch (error) {
      rethrowWithRecovery(error, '请换一个名称后重试。')
    }
  })

  registrar.registerHandler('open_document', async (raw, context) => {
    throwIfCapabilityAborted(context.signal)
    const input = parseCapabilityInput<{ documentId: string }>('open_document', raw)
    const document = await operations().findDocument(input.documentId)
    await operations().openDocument(document)
    return { resultRef: documentRef(document.id), name: document.name, kind: document.kind }
  })

  registrar.registerHandler('move_document', async (raw, context) => {
    throwIfCapabilityAborted(context.signal)
    const input = parseCapabilityInput<{ documentId: string; projectId: string | null; onConflict: 'fail' | 'keepBoth' }>('move_document', raw)
    const document = await operations().findDocument(input.documentId)
    const container: DocumentContainerRef = input.projectId ? { kind: 'project', projectId: input.projectId } : { kind: 'user' }
    try {
      const result = await operations().moveDocument({ id: document.id, path: document.path }, container, input.onConflict)
      return {
        resultRef: documentRef(result.meta.id),
        name: result.meta.name,
        projectId: result.meta.container.kind === 'project' ? result.meta.container.projectId : null,
        copiedFiles: result.copiedFiles,
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
    return { resultRef: documentRef(result.meta.id), name: result.meta.name, sourceRef: documentRef(document.id) }
  })

  registrar.registerHandler('trash_document', async (raw, context) => {
    throwIfCapabilityAborted(context.signal)
    const input = parseCapabilityInput<{ documentId: string }>('trash_document', raw)
    const document = await operations().findDocument(input.documentId)
    await operations().trashDocument({ id: document.id, path: document.path, name: document.name })
    return { resultRef: documentRef(document.id), name: document.name, status: 'trashed' as const }
  })

  registrar.registerHandler('create_project', async (raw, context) => {
    throwIfCapabilityAborted(context.signal)
    const input = parseCapabilityInput<{ name: string }>('create_project', raw)
    try {
      const project = await operations().createProject(input.name)
      return { resultRef: { kind: DOCUMENT_PROJECT_ENTITY_TYPE, id: project.id }, name: project.name }
    } catch (error) {
      rethrowWithRecovery(error, '请换一个名称后重试。')
    }
  })
}
