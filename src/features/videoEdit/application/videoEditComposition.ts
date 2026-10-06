import { createLogger } from '@/core/logging'
import type { DocumentKindId, DocumentLink, DocumentMeta, DocumentSummary } from '@/core/documents/types'
import { documentKindRegistry } from '@/core/documents/kinds'
import type { VideoEditCreativeSource } from '@/core/videoEdit/creativeResult'
import type { EmbeddedHost } from '@/features/documents/embeddedDocuments'
import { readGenerationResultMedia } from '@/features/generation/application/generationResultSource'
import { openApplicationSurface } from '@/features/navigation/application/surfaceNavigationService'
import { revealGenerationTask } from '@/workspaces/GenerationWorkspace/application/generationTaskNavigation'
import { editVideoProject, getActiveVideoEditSequence, openVideoEditDocument, requireVideoEditInstance, videoEditDocumentOperations } from './videoEditService'

/*
 * 在剪辑里组合各类文档（4.1 自由组合）：剪辑是项目的主文档，从它出发——
 * - 在项目里新建画布 / 口播 / 镜头参考 / 图片文档，或打开本项目、别处的文档，都以“嵌入模式”打开：
 *   工具命令带左端显示“返回剪辑 · 项目名”，返回时走该工具的离开流程，回到剪辑原来的位置（剪辑工作区切走不卸载）；
 * - 把别处的文档移进 / 复制进本项目（复制换新 ID，原容器里用到的素材一并复制）；
 * - 片段“回到来源继续编辑”：打开来源文档并定位到部位（画布节点），或打开生成记录；
 *   来源文档找不到时由界面提示，可以重新定位到一份文件，本剪辑里引用它的片段一并改写（一次撤销即可恢复）。
 * 剪辑里引用的、不在本项目里的文档在素材面板标出“来自其他位置”，“收集素材”会把它们复制进项目。
 */

const logger = createLogger('features.videoEdit.composition')
const kindOfPath = (filePath: string) => documentKindRegistry.forFileName(filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1))

/** 剪辑里可以新建的文档类型（剪辑本身除外），按素材面板的显示顺序。 */
export const VIDEO_EDIT_COMPOSABLE_KINDS: readonly DocumentKindId[] = ['canvas', 'audio_edit', 'camera_stage', 'image_document']

/** 嵌入模式的宿主：返回按钮显示剪辑所在项目的名称，返回时重新显示这份剪辑。 */
export async function videoEditEmbedHost(projectId: string): Promise<EmbeddedHost> {
  const instance = requireVideoEditInstance(projectId)
  const container = instance.session.documentMeta.container
  const project = container.kind === 'project' ? await videoEditDocumentOperations().findProject(container.projectId).catch(() => null) : null
  const target = { id: instance.document.id, path: instance.session.documentMeta.path }
  return {
    label: project?.name ?? instance.document.name,
    async returnToHost() {
      await openVideoEditDocument({ id: target.id, path: requireOpenPath(target.id) ?? target.path })
      openApplicationSurface('workspace.video_edit')
    },
  }
}

function requireOpenPath(id: string): string | undefined {
  try { return requireVideoEditInstance(id).session.documentMeta.path } catch { return undefined }
}

function projectContainerOf(projectId: string): { kind: 'project'; projectId: string } {
  const container = requireVideoEditInstance(projectId).session.documentMeta.container
  if (container.kind !== 'project') throw new Error('剪辑不在任何项目里。')
  return container
}

/** 在剪辑所在项目里新建一份文档并以嵌入模式打开；用户取消（如没选素材）时返回 null。 */
export async function createDocumentInVideoEdit(projectId: string, kind: DocumentKindId): Promise<DocumentMeta | null> {
  if (!VIDEO_EDIT_COMPOSABLE_KINDS.includes(kind)) throw new Error('剪辑里不能新建这种文档。')
  const container = projectContainerOf(projectId)
  const instance = requireVideoEditInstance(projectId)
  const sequence = getActiveVideoEditSequence(instance)
  const embedIn = await videoEditEmbedHost(projectId)
  const created = await videoEditDocumentOperations().createAndOpenDocument(kind, container, { embedIn, size: { width: sequence.width, height: sequence.height } })
  logger.info('在剪辑里新建文档', { event: 'video_edit.composition.create.completed', context: { projectId, kind, created: Boolean(created) } })
  return created
}

/** 以嵌入模式打开一份文档（本项目的或别处的），可定位到部位。 */
export async function openDocumentFromVideoEdit(projectId: string, document: DocumentSummary, part?: string): Promise<void> {
  const embedIn = await videoEditEmbedHost(projectId)
  await videoEditDocumentOperations().openDocument(document, { embedIn, ...(part !== undefined ? { part } : {}) })
  logger.info('从剪辑打开文档', { event: 'video_edit.composition.open.completed', context: { projectId, docId: document.id, kind: document.kind, part: part !== undefined } })
}

/**
 * 把别处的文档移进（move）或复制进（copy）剪辑所在项目。复制换新 ID、原容器里用到的素材一并复制；
 * 重名时两个都保留（自动加序号）。返回放进项目后的文档。
 */
export async function bringDocumentIntoVideoEditProject(projectId: string, document: DocumentSummary, mode: 'move' | 'copy'): Promise<DocumentMeta> {
  const container = projectContainerOf(projectId)
  const operations = videoEditDocumentOperations()
  const target = { id: document.id, path: document.path }
  const result = mode === 'move'
    ? await operations.moveDocument(target, container, 'keepBoth')
    : await operations.duplicateDocument(target, 'keepBoth', container)
  logger.info('文档放进剪辑所在项目', { event: 'video_edit.composition.bring.completed', context: { projectId, docId: document.id, mode, copiedFiles: result.copiedFiles } })
  return result.meta
}

/** 找一个片段（在全部序列里找）。 */
function findClip(projectId: string, clipId: string): { source: VideoEditCreativeSource | undefined } {
  const instance = requireVideoEditInstance(projectId)
  for (const sequence of instance.document.sequences) {
    const clip = sequence.clips.find((candidate) => candidate.id === clipId)
    if (clip) return { source: clip.creativeSource }
  }
  throw new Error('片段不存在。')
}

export function videoEditClipSource(projectId: string, clipId: string): VideoEditCreativeSource | null {
  return findClip(projectId, clipId).source ?? null
}

export type VideoEditClipSourceOutcome =
  | { status: 'opened'; kind: DocumentKindId | 'generation' }
  /** 来源文档找不到：可以重新定位（extension 是原来那份文档的扩展名）；生成记录找不到不能重新定位。 */
  | { status: 'missing'; source: VideoEditCreativeSource; extension: string | null }

/** 回到来源继续编辑：打开来源文档并定位到部位，或打开生成记录。 */
export async function openVideoEditClipSource(projectId: string, clipId: string): Promise<VideoEditClipSourceOutcome> {
  const source = videoEditClipSource(projectId, clipId)
  if (!source) throw new Error('这个片段没有记录来源，可能是直接导入的素材。')
  if (source.type === 'generation') {
    const record = await readGenerationResultMedia(source.recordId).catch(() => null)
    if (!record) return { status: 'missing', source, extension: null }
    openApplicationSurface('workspace.generation')
    revealGenerationTask(source.recordId)
    logger.info('回到来源：生成记录', { event: 'video_edit.clip_source.open.completed', context: { projectId, clipId, type: 'generation' } })
    return { status: 'opened', kind: 'generation' }
  }
  const operations = videoEditDocumentOperations()
  const resolved = await operations.resolveDocumentLink(source.docRef)
  const summary = resolved.status === 'found' ? await operations.findDocument(resolved.meta.id).catch(() => null) : null
  if (!summary || summary.missing) {
    logger.warn('回到来源：来源文档找不到', { event: 'video_edit.clip_source.open.missing', context: { projectId, clipId } })
    return { status: 'missing', source, extension: kindOfPath(source.docRef.path)?.extension ?? null }
  }
  await openDocumentFromVideoEdit(projectId, summary, source.part)
  logger.info('回到来源：文档', { event: 'video_edit.clip_source.open.completed', context: { projectId, clipId, kind: summary.kind } })
  return { status: 'opened', kind: summary.kind }
}

/**
 * 重新定位来源：用户选了一份文件，本剪辑里引用原来那份文档（按 ID）的片段全部改指向它。
 * 选的文件必须是同一类型的痕迹AI文档。一次修改，一次撤销即可恢复。返回改写的片段数。
 */
export async function relocateVideoEditClipSource(projectId: string, previousDocId: string, pickedPath: string): Promise<number> {
  const instance = requireVideoEditInstance(projectId)
  const previous = instance.document.sequences.flatMap((sequence) => sequence.clips)
    .map((clip) => clip.creativeSource)
    .find((source): source is Extract<VideoEditCreativeSource, { type: 'document' }> => source?.type === 'document' && source.docRef.docId === previousDocId)
  if (!previous) throw new Error('剪辑里没有引用这份文档的片段。')
  const expected = kindOfPath(previous.docRef.path)
  const picked = kindOfPath(pickedPath)
  if (!picked || (expected && picked.id !== expected.id)) throw new Error('请选择同一类型的痕迹AI文档。')
  const resolved = await videoEditDocumentOperations().resolveDocumentLink({ docId: previousDocId, path: pickedPath })
  if (resolved.status !== 'found') throw new Error('选择的文件读不出来，请换一份。')
  const docRef: DocumentLink = { docId: resolved.meta.id, path: resolved.meta.path }
  let rewritten = 0
  editVideoProject(projectId, (document) => ({
    ...document,
    sequences: document.sequences.map((sequence) => ({
      ...sequence,
      clips: sequence.clips.map((clip) => {
        const source = clip.creativeSource
        if (source?.type !== 'document' || source.docRef.docId !== previousDocId) return clip
        rewritten += 1
        return { ...clip, creativeSource: { ...source, docRef } }
      }),
    })),
  }))
  logger.info('片段来源已重新定位', { event: 'video_edit.clip_source.relocate.completed', context: { projectId, clips: rewritten, sameId: resolved.meta.id === previousDocId } })
  return rewritten
}

export interface VideoEditReferencedDocument {
  docRef: DocumentLink
  /** 找到的文档（找不到时为 null）。 */
  document: DocumentSummary | null
  /** 不在剪辑所在项目里（别的项目或作品目录、外部位置）。 */
  elsewhere: boolean
  clips: number
}

/** 剪辑片段引用到的文档（按 ID 合并），标出不在本项目里的与找不到的。 */
export async function listVideoEditReferencedDocuments(projectId: string): Promise<VideoEditReferencedDocument[]> {
  const instance = requireVideoEditInstance(projectId)
  const container = instance.session.documentMeta.container
  const refs = new Map<string, { docRef: DocumentLink; clips: number }>()
  for (const clip of instance.document.sequences.flatMap((sequence) => sequence.clips)) {
    const source = clip.creativeSource
    if (source?.type !== 'document') continue
    const entry = refs.get(source.docRef.docId) ?? { docRef: source.docRef, clips: 0 }
    entry.clips += 1
    refs.set(source.docRef.docId, entry)
  }
  const operations = videoEditDocumentOperations()
  const result: VideoEditReferencedDocument[] = []
  for (const { docRef, clips } of refs.values()) {
    const resolved = await operations.resolveDocumentLink(docRef).catch(() => ({ status: 'missing' as const }))
    const document = resolved.status === 'found' ? await operations.findDocument(resolved.meta.id).catch(() => null) : null
    const inProject = Boolean(document && container.kind === 'project' && document.container.kind === 'project' && document.container.projectId === container.projectId)
    result.push({ docRef, document, elsewhere: Boolean(document) && !inProject, clips })
  }
  return result
}
