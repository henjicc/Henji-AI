import fsp from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { documentKindRegistry } from '../../../../../src/core/documents/kinds'
import type { ImageDocumentContent } from '../../../../../src/core/documents/kinds/imageDocument'
import { entryNameKey, untitledEntryName } from '../../../../../src/core/documents/naming'
import type {
  DocumentContainerRef,
  DocumentListQuery,
  DocumentMeta,
  DocumentReadResult,
  DocumentSummary,
  DocumentTarget,
  FolderLocale,
  ProjectListQuery,
  ProjectSummary,
  SaveDocumentCoverRequest,
} from '../../../../../src/core/documents/types'
import { replaceFileAtomically } from '../../fs/atomic-file'
import { withFileLock } from '../../fs/file-lock'
import { EntryExistsError, moveFileNoOverwrite } from '../../fs/no-overwrite'
import {
  DocumentLocationError,
  DocumentNotFoundError,
  DocumentRevisionConflictError,
  ProjectNotFoundError,
} from '../../documents/errors'
import { readEntryNameKeys } from '../../documents/name-check'
import type { MainLogger } from '../../logging/main-logger'
import type { ImageEditDocumentEnvelope, ResourceId } from '../contracts'
import type { ImageEditDocumentRepository } from '../document-repository'
import type { HenjiImagePackageCodec } from '../package-codec'
import { stagedPackagePathFor } from '../package-export'
import { KeyedSerialExecutor } from '../serial-executor'
import {
  IMAGE_DOCUMENT_HEADER_FORMAT,
  IMAGE_DOCUMENT_HEADER_VERSION,
  IMAGE_DOCUMENT_KIND_VERSION,
  ImageDocumentHeaderError,
  isImageDocumentId,
  legacyImageDocumentHeader,
  parseImageDocumentHeaderBytes,
  serializeImageDocumentHeader,
  summarizeImageEditDocument,
  withImageEditDocumentId,
  type HenjiImageDocumentHeader,
} from './header'
import { readImageDocumentPackageHeader } from './package-file'
import type { ImageDocumentWorkingCopyLinks } from './working-copy-links'

/*
 * 图片文档服务（3.5）：`.henjiimg` 是正式文件，编辑发生在程序目录的工作副本里。
 *
 * - 打开：工作副本与文件一致（记录里的文件版本、大小、修改时间都对得上）时直接复用；
 *   工作副本有没写回的修改（意外退出）时先请用户选择恢复或使用文件里的版本；其余情况把包解到工作副本
 *   （资源进内容寻址资源库，按哈希去重），包内 V3 文档 ID 统一换成文档 ID。
 * - 新建：渲染层先把来源图片做成工作副本（V3 文档 ID 就是新文档 ID），这里写出草稿包，
 *   放进它最终所在的文件夹（自动名“未命名图片 N”，不覆盖）。
 * - 写回：在锁外把工作副本写成暂存包，再在文档锁（与通用文档仓库同一把）内核对文件版本后原子替换；
 *   期间文件被改名、移动或转正时按新位置重来。文件版本与打开时不一致即冲突，除非调用方选择覆盖。
 * - 包里只有内容寻址资源、V3 文档与文档头，不写任何程序目录路径。
 */

export type ImageDocumentRecoveryChoice = 'ask' | 'restore' | 'discard'

export interface ImageDocumentWorkingReference {
  documentRef: `image-edit-v3:${string}`
  revision: number
  previewRef: ResourceId | null
  /** 底层原图的受管媒体地址（内容哈希能力 URL，不含路径）；编辑器显示单图层时直接用它。 */
  sourceUrl: string | null
}

export interface ImageDocumentOpenResult {
  status: 'ready'
  read: DocumentReadResult
  working: ImageDocumentWorkingReference
  /** 这次从文件重新解包（渲染层若还留着这份文档的旧实例，需要丢弃）。 */
  imported: boolean
}

export interface ImageDocumentRecoveryRequired {
  status: 'recovery'
  meta: DocumentMeta
  /** 工作副本最后一次保存的时间（毫秒）。 */
  workingSavedAt: number
  /** 文件最后一次写回的时间（毫秒）。 */
  fileSavedAt: number
}

export interface ImageDocumentCommitResult {
  meta: DocumentMeta
  unchanged: boolean
}

export interface ImageDocumentThumbnailInput {
  bytes: Uint8Array
  extension: string
  mediaType: string
}

/** 文档底座里图片文档服务用到的部分；正式运行由 getDocumentService() 与作品目录布局提供。 */
export interface ImageDocumentCatalogAccess {
  listDocuments(query: DocumentListQuery): Promise<DocumentSummary[]>
  listProjects(query: ProjectListQuery): Promise<ProjectSummary[]>
  refreshIndex(): Promise<unknown>
  saveDocumentCover(request: SaveDocumentCoverRequest): Promise<unknown>
  layout(): { root: string; locale: FolderLocale }
}

export interface ImageDocumentServiceOptions {
  documents: ImageEditDocumentRepository
  packages: HenjiImagePackageCodec
  links: ImageDocumentWorkingCopyLinks
  catalog: ImageDocumentCatalogAccess
  /** 与通用文档仓库同一个锁目录（程序目录 DocumentStore/locks），写回与改名、移动互斥。 */
  lockDirectory: string
  logger: MainLogger
  /** 校验工作副本能被编辑器读取（与 V3 IPC 的快照校验相同）。 */
  validateDocument(envelope: ImageEditDocumentEnvelope): void
  /** 封面来源：资源库里某个资源的本地文件（只用于在程序目录生成封面，不进文档）。 */
  resourceFilePath(resourceId: ResourceId): string
  /** 资源的受管媒体地址；不能显示的类型返回 null。 */
  resourceMediaUrl(resourceId: ResourceId): Promise<string | null>
  now?: () => Date
}

interface LocatedPackage {
  path: string
  header: HenjiImageDocumentHeader
  legacy: boolean
  container: DocumentContainerRef
  fileSize: number
  fileModifiedAt: number
}

const KIND = documentKindRegistry.require('image_document')
/**
 * 工作副本回收策略（4.1 定，补 3.5 遗留）：每次启动后在后台检查一次，只回收“与文件一致”（已写回、没有未写回修改）
 * 且本次运行里没有用过的图片文档工作副本，保留最近用过的这么多份（再次打开免解包），其余删除。
 * 删除只动图片文档自己的工作副本与记录；画布内嵌的图层文档另有记录（canvas-layer-links），不在这里。
 * 资源按内容寻址存放，由图片编辑现有的资源回收释放；下次打开按文件重新解包。
 */
const KEEP_RECENT_WORKING_COPIES = 8
const MAX_NAME_ATTEMPTS = 100
const MAX_COMMIT_ATTEMPTS = 3

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : undefined
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function documentRefOf(documentId: string): `image-edit-v3:${string}` {
  return `image-edit-v3:${documentId}`
}

function nameOf(filePath: string): string {
  const base = path.basename(filePath)
  return base.toLowerCase().endsWith(KIND.extension) ? base.slice(0, -KIND.extension.length) : base
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class ImageDocumentService {
  /** 本次运行里打开、新建、写回过的图片文档：回收时一律跳过（可能还开着）。 */
  private readonly touched = new Set<string>()
  private readonly commits = new KeyedSerialExecutor()

  constructor(private readonly options: ImageDocumentServiceOptions) {}

  /** 在文档锁里登记“用过”：正在进行的回收先做完，之后的回收都会跳过它。 */
  private async touch(documentId: string): Promise<void> {
    if (this.touched.has(documentId) || !isImageDocumentId(documentId)) return
    await this.exclusive(documentId, async () => { this.touched.add(documentId) })
  }

  private get logger(): MainLogger {
    return this.options.logger
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  // ==================== 公共操作 ====================

  /** 打开：按需解包到工作副本；有没写回的修改时先返回 recovery，由渲染层询问后带着选择再打开。 */
  async open(target: DocumentTarget, recovery: ImageDocumentRecoveryChoice): Promise<ImageDocumentOpenResult | ImageDocumentRecoveryRequired> {
    await this.touch(target.id)
    const located = await this.locate(target)
    const id = located.header.id
    await this.touch(id)
    const link = await this.options.links.read(id)
    const working = await this.loadWorking(id)
    const uncommitted = Boolean(working && link && working.revision > link.committedWorkingRevision)
    if (uncommitted && working && recovery === 'ask') {
      this.logger.info('图片文档有未写回的修改，等待用户选择', { event: 'image_document.open.recovery_required', context: { documentId: id } })
      return { status: 'recovery', meta: this.metaOf(located), workingSavedAt: toTimestamp(working.updatedAt), fileSavedAt: toTimestamp(located.header.updatedAt) }
    }
    if (uncommitted && working && link && recovery === 'restore') {
      // 用工作副本继续：记下文件当前的样子，下一次写回按它核对（用户已选择用工作副本覆盖文件）。
      await this.options.links.write({ ...link, packageRevision: located.header.revision, fileSize: located.fileSize, fileModifiedAt: located.fileModifiedAt })
      this.logger.info('图片文档按工作副本恢复', { event: 'image_document.open.restored', context: { documentId: id, workingRevision: working.revision } })
      return { status: 'ready', read: this.readResult(located, working), working: await this.workingReference(working), imported: false }
    }
    const reusable = !uncommitted && working && link
      && link.packageRevision === located.header.revision
      && link.fileSize === located.fileSize
      && link.fileModifiedAt === located.fileModifiedAt
      && link.committedWorkingRevision === working.revision
    if (reusable && working) {
      this.logger.debug('图片文档复用工作副本', { event: 'image_document.open.reused', context: { documentId: id } })
      return { status: 'ready', read: this.readResult(located, working), working: await this.workingReference(working), imported: false }
    }
    const imported = await this.importPackage(located)
    return { status: 'ready', read: this.readResult(located, imported), working: await this.workingReference(imported), imported: true }
  }

  /** 位置可能变了（改名、移动、转正后）：只重新定位并描述工作副本，不重新解包。 */
  async describe(target: DocumentTarget): Promise<ImageDocumentOpenResult> {
    await this.touch(target.id)
    const located = await this.locate(target)
    const working = await this.loadWorking(located.header.id)
    if (!working) {
      const imported = await this.importPackage(located)
      return { status: 'ready', read: this.readResult(located, imported), working: await this.workingReference(imported), imported: true }
    }
    return { status: 'ready', read: this.readResult(located, working), working: await this.workingReference(working), imported: false }
  }

  /** 新建草稿：工作副本已由渲染层建好（V3 文档 ID 即文档 ID），写出草稿包到最终所在的文件夹。 */
  async create(request: {
    documentId: string
    container: DocumentContainerRef
    emptyUntilRevision: number | null
  }): Promise<ImageDocumentOpenResult> {
    const id = request.documentId
    if (!isImageDocumentId(id)) throw new DocumentLocationError('图片文档 ID 无效。')
    await this.touch(id)
    const existing = await this.options.catalog.listDocuments({ kind: KIND.id, includeDrafts: true, includeMissing: true })
    if (existing.some((row) => row.id === id)) throw new DocumentLocationError('图片文档 ID 已被占用。')
    const working = await this.options.documents.loadCheckpoint(id)
    this.options.validateDocument(working)
    const { folder, locale } = await this.folderFor(request.container)
    const now = this.now().toISOString()
    const header: HenjiImageDocumentHeader = {
      format: IMAGE_DOCUMENT_HEADER_FORMAT,
      version: IMAGE_DOCUMENT_HEADER_VERSION,
      id,
      draft: true,
      revision: 0,
      kindVersion: IMAGE_DOCUMENT_KIND_VERSION,
      createdAt: now,
      updatedAt: now,
      contentRevision: working.revision,
      emptyUntilRevision: request.emptyUntilRevision,
      summary: summarizeImageEditDocument(working.document),
    }
    await fsp.mkdir(folder, { recursive: true })
    const stagedPath = stagedPackagePathFor(path.join(folder, `${KIND.untitledNames[locale]}${KIND.extension}`))
    let target: string | null = null
    try {
      await this.options.packages.writeStaged({ document: working, documentHeader: serializeImageDocumentHeader(header) }, stagedPath)
      for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS && target === null; attempt += 1) {
        const taken = await readEntryNameKeys(folder)
        const name = untitledEntryName(KIND.untitledNames[locale], (candidate) => taken.has(entryNameKey(`${candidate}${KIND.extension}`)))
        const candidate = path.join(folder, `${name}${KIND.extension}`)
        try {
          await moveFileNoOverwrite(stagedPath, candidate)
          target = candidate
        } catch (error) {
          if (!(error instanceof EntryExistsError)) throw error
        }
      }
      if (target === null) throw new Error('同名文件过多，请先整理文件夹。')
    } finally {
      await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
    }
    const stat = await fsp.stat(target)
    await this.options.links.write({
      documentId: id, packageRevision: 0, fileSize: stat.size, fileModifiedAt: stat.mtimeMs, committedWorkingRevision: working.revision,
    })
    await this.options.catalog.refreshIndex()
    const located = await this.locate({ id, path: target })
    this.saveCoverInBackground(id, working, null)
    this.logger.info('图片文档草稿已新建', { event: 'image_document.create.completed', context: { documentId: id, container: request.container.kind, blank: request.emptyUntilRevision !== null } })
    return { status: 'ready', read: this.readResult(located, working), working: await this.workingReference(working), imported: false }
  }

  /** 写回：把工作副本整包写进 `.henjiimg`。工作副本与文件一致时不写。 */
  async commit(request: {
    target: DocumentTarget
    expectedRevision: number
    force?: boolean
    thumbnail?: ImageDocumentThumbnailInput
    signal?: AbortSignal
  }): Promise<ImageDocumentCommitResult> {
    const started = performance.now()
    this.logger.info('开始写回图片文档', { event: 'image_document.commit.start', context: { documentId: request.target.id } })
    try {
      const result = await this.commits.run(request.target.id, () => this.commitWorkingCopy(request))
      this.logger.info('图片文档保存确认完成', { event: 'image_document.commit.confirmed', context: {
        documentId: request.target.id, elapsedMs: performance.now() - started, unchanged: result.unchanged,
      } })
      return result
    } catch (error) {
      this.logger.error('图片文档写回失败', { event: 'image_document.commit.failed', context: {
        documentId: request.target.id, elapsedMs: performance.now() - started,
      }, error })
      throw error
    }
  }

  private async commitWorkingCopy(request: {
    target: DocumentTarget
    expectedRevision: number
    force?: boolean
    thumbnail?: ImageDocumentThumbnailInput
    signal?: AbortSignal
  }): Promise<ImageDocumentCommitResult> {
    request.signal?.throwIfAborted()
    const id = request.target.id
    await this.touch(id)
    const working = await this.options.documents.loadCheckpoint(id)
    this.options.validateDocument(working)
    let located = await this.locate(request.target)
    const link = await this.options.links.read(id)
    if (!request.force && located.header.revision !== request.expectedRevision) {
      throw new DocumentRevisionConflictError(id, request.expectedRevision, located.header.revision)
    }
    const fileMatchesLink = link !== null
      && link.packageRevision === located.header.revision
      && link.fileSize === located.fileSize
      && link.fileModifiedAt === located.fileModifiedAt
    if (!request.force && fileMatchesLink && link.committedWorkingRevision === working.revision && !located.legacy) {
      return { meta: this.metaOf(located), unchanged: true }
    }
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const header: HenjiImageDocumentHeader = {
        ...located.header,
        format: IMAGE_DOCUMENT_HEADER_FORMAT,
        version: IMAGE_DOCUMENT_HEADER_VERSION,
        id,
        revision: located.header.revision + 1,
        kindVersion: IMAGE_DOCUMENT_KIND_VERSION,
        updatedAt: this.now().toISOString(),
        contentRevision: working.revision,
        summary: summarizeImageEditDocument(working.document),
      }
      const stagedPath = stagedPackagePathFor(located.path)
      try {
        await this.options.packages.writeStaged({
          document: working,
          documentHeader: serializeImageDocumentHeader(header),
          ...(request.thumbnail ? { thumbnail: request.thumbnail } : {}),
          signal: request.signal,
        }, stagedPath)
        const published = await this.exclusive(id, async () => {
          request.signal?.throwIfAborted()
          const current = await this.locate(request.target)
          if (!request.force && current.header.revision !== request.expectedRevision) {
            throw new DocumentRevisionConflictError(id, request.expectedRevision, current.header.revision)
          }
          // 写暂存包期间文件被改名、移动、转正或写回过：按最新的样子重来。
          if (current.path !== located.path || current.header.draft !== located.header.draft || current.header.revision !== located.header.revision) {
            return { retry: current }
          }
          request.signal?.throwIfAborted()
          await replaceFileAtomically(stagedPath, current.path)
          return { retry: null }
        })
        if (published.retry) {
          located = published.retry
          continue
        }
      } finally {
        await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
      }
      const stat = await fsp.stat(located.path)
      await this.options.links.write({
        documentId: id, packageRevision: header.revision, fileSize: stat.size, fileModifiedAt: stat.mtimeMs, committedWorkingRevision: working.revision,
      })
      const committed: LocatedPackage = { ...located, header, legacy: false, fileSize: stat.size, fileModifiedAt: stat.mtimeMs }
      this.saveCoverInBackground(id, working, request.thumbnail ?? null)
      void this.options.catalog.refreshIndex().catch(() => undefined)
      this.logger.info('图片文档已写回', {
        event: 'image_document.commit.completed',
        context: { documentId: id, revision: header.revision, workingRevision: working.revision, force: request.force === true },
      })
      return { meta: this.metaOf(committed), unchanged: false }
    }
    throw new DocumentLocationError('图片文档正在被移动或改名，请稍后再试。')
  }

  /**
   * 回收工作副本（见 KEEP_RECENT_WORKING_COPIES）：返回删除的数量。逐份在文档锁里复核：
   * 本次运行用过的、有未写回修改的（意外退出待恢复）、记录与文件对不上的一律保留。
   */
  async pruneWorkingCopies(keep = KEEP_RECENT_WORKING_COPIES): Promise<number> {
    const links = (await this.options.links.list()).sort((left, right) => right.touchedAt - left.touchedAt)
    let removed = 0
    for (const { documentId } of links.slice(keep)) {
      if (this.touched.has(documentId)) continue
      try {
        const deleted = await this.exclusive(documentId, async () => {
          if (this.touched.has(documentId)) return false
          const link = await this.options.links.read(documentId)
          const working = await this.loadWorking(documentId)
          if (!link) return false
          if (working && working.revision !== link.committedWorkingRevision) return false
          if (working && !await this.options.documents.deleteIfRevision(documentId, working.revision)) return false
          await this.options.links.remove(documentId)
          return true
        })
        if (deleted) removed += 1
      } catch (error) {
        this.logger.warn('回收图片文档工作副本失败，下次启动再试', { event: 'image_document.working_copy.prune_failed', context: { documentId }, error })
      }
    }
    if (removed) this.logger.info('已回收图片文档工作副本', { event: 'image_document.working_copy.pruned', context: { removed, kept: Math.min(keep, links.length) } })
    return removed
  }

  /** 这份 V3 文档是不是某份图片文档的工作副本（图片文档按作品索引列出，不混进程序目录的文档列表）。 */
  async isWorkingCopy(documentId: string): Promise<boolean> {
    return isImageDocumentId(documentId) && await this.options.links.read(documentId) !== null
  }

  // ==================== 定位与工作副本 ====================

  private async locate(target: DocumentTarget): Promise<LocatedPackage> {
    try {
      return await this.locateOnce(target)
    } catch (error) {
      if (!(error instanceof DocumentNotFoundError)) throw error
      // 文件刚被改名、移动或拷进来，索引还没跟上：扫描一次再找。
      await this.options.catalog.refreshIndex()
      return await this.locateOnce(target)
    }
  }

  private async locateOnce(target: DocumentTarget): Promise<LocatedPackage> {
    const rows = await this.options.catalog.listDocuments({ kind: KIND.id, includeDrafts: true, includeMissing: true })
    const row = rows.find((candidate) => candidate.id === target.id)
    const candidates = [...new Set([target.path, row?.path].filter((value): value is string => typeof value === 'string' && path.isAbsolute(value)))]
    for (const candidate of candidates) {
      let read: Awaited<ReturnType<typeof readImageDocumentPackageHeader>>
      let stat: Awaited<ReturnType<typeof fsp.stat>>
      try {
        stat = await fsp.stat(candidate)
        if (!stat.isFile()) continue
        read = await readImageDocumentPackageHeader(candidate)
      } catch (error) {
        if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') continue
        throw error
      }
      if (read.header.id !== target.id) continue
      const container = rows.find((candidateRow) => candidateRow.id === target.id && candidateRow.path === candidate)?.container
        ?? row?.container
        ?? { kind: 'user' as const }
      return { path: candidate, header: read.header, legacy: read.legacy, container, fileSize: stat.size, fileModifiedAt: stat.mtimeMs }
    }
    throw new DocumentNotFoundError(target.id)
  }

  private async loadWorking(id: string): Promise<ImageEditDocumentEnvelope | null> {
    try {
      const envelope = await this.options.documents.loadCheckpoint(id)
      this.options.validateDocument(envelope)
      return envelope
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null
      // 工作副本损坏：当作没有，按文件重新解包。
      this.logger.warn('图片文档工作副本无法读取，将按文件重新解包', { event: 'image_document.working.invalid', context: { documentId: id }, error })
      return null
    }
  }

  private async importPackage(located: LocatedPackage): Promise<ImageEditDocumentEnvelope> {
    const id = located.header.id
    const imported = await this.options.packages.import(located.path, { restoreHistory: false })
    try {
      if (imported.missingExternalSources.length > 0) {
        throw new ImageDocumentHeaderError('这份图片文档引用了不在包里的外部图片，无法打开。')
      }
      const header = imported.documentHeader ? parseImageDocumentHeaderBytes(imported.documentHeader) : legacyImageDocumentHeader(imported.manifest.document, imported.manifest.createdAt)
      if (header.id !== id) throw new DocumentNotFoundError(id)
      const envelope = withImageEditDocumentId(imported.manifest.document, id)
      this.options.validateDocument(envelope)
      const working = await this.options.documents.replace(envelope)
      await this.options.links.write({
        documentId: id, packageRevision: located.header.revision, fileSize: located.fileSize, fileModifiedAt: located.fileModifiedAt, committedWorkingRevision: working.revision,
      })
      if (imported.thumbnail && imported.manifest.thumbnail) {
        const thumbnail = imported.thumbnail
        const mediaType = imported.manifest.thumbnail.mediaType
        this.saveCoverInBackground(id, working, { bytes: thumbnail, extension: mediaType.slice('image/'.length), mediaType })
      } else {
        this.saveCoverInBackground(id, working, null)
      }
      this.logger.info('图片文档已解包到工作副本', { event: 'image_document.import.completed', context: { documentId: id, revision: working.revision, legacy: located.legacy } })
      return working
    } finally {
      await imported.resourceLease.release()
    }
  }

  // ==================== 组装结果 ====================

  private metaOf(located: LocatedPackage): DocumentMeta {
    return {
      id: located.header.id,
      kind: KIND.id,
      name: nameOf(located.path),
      path: located.path,
      container: located.container,
      draft: located.header.draft,
      revision: located.header.revision,
      kindVersion: located.header.kindVersion,
      createdAt: toTimestamp(located.header.createdAt),
      updatedAt: toTimestamp(located.header.updatedAt),
    }
  }

  private readResult(located: LocatedPackage, working: ImageEditDocumentEnvelope): DocumentReadResult {
    const summary = summarizeImageEditDocument(working.document)
    const content: ImageDocumentContent = {
      workingRevision: working.revision,
      emptyUntilRevision: located.header.emptyUntilRevision,
      width: summary.width,
      height: summary.height,
      layers: summary.layers,
    }
    return { meta: this.metaOf(located), content, missingPaths: [], externalDirectories: [], unresolved: [] }
  }

  private async workingReference(working: ImageEditDocumentEnvelope): Promise<ImageDocumentWorkingReference> {
    const base = this.baseLayerResource(working.document)
    let sourceUrl: string | null = null
    if (base) {
      try {
        sourceUrl = await this.options.resourceMediaUrl(base)
      } catch (error) {
        this.logger.warn('图片文档原图地址生成失败', { event: 'image_document.source_url.failed', context: { documentId: working.documentId }, error })
      }
    }
    return { documentRef: documentRefOf(working.documentId), revision: working.revision, previewRef: working.previewRef ?? null, sourceUrl }
  }

  private async folderFor(container: DocumentContainerRef): Promise<{ folder: string; locale: FolderLocale }> {
    const layout = this.options.catalog.layout()
    if (container.kind === 'user') {
      const names = KIND.standaloneFolderNames
      if (!names) throw new DocumentLocationError('这种文档只能放在项目里。')
      return { folder: path.join(layout.root, names[layout.locale]), locale: layout.locale }
    }
    const find = async (): Promise<ProjectSummary | undefined> => (
      (await this.options.catalog.listProjects({ includeDrafts: true, includeMissing: false })).find((project) => project.id === container.projectId)
    )
    let project = await find()
    if (!project) {
      await this.options.catalog.refreshIndex()
      project = await find()
    }
    if (!project) throw new ProjectNotFoundError(container.projectId)
    return { folder: project.path, locale: project.locale }
  }

  /** 封面在程序目录生成：优先用编辑器给的缩略图，其次用预览或底层图片资源。失败只记日志。 */
  private saveCoverInBackground(id: string, working: ImageEditDocumentEnvelope, thumbnail: ImageDocumentThumbnailInput | null): void {
    let source: string | null = null
    if (thumbnail) {
      source = `data:${thumbnail.mediaType};base64,${Buffer.from(thumbnail.bytes.buffer, thumbnail.bytes.byteOffset, thumbnail.bytes.byteLength).toString('base64')}`
    } else {
      const resource = working.previewRef ?? this.baseLayerResource(working.document)
      if (resource) source = this.options.resourceFilePath(resource)
    }
    if (!source) return
    void this.options.catalog.saveDocumentCover({ docId: id, sources: [{ source, sourceKind: 'image' }] }).catch((error: unknown) => {
      this.logger.warn('图片文档封面生成失败', { event: 'image_document.cover.failed', context: { documentId: id }, error })
    })
  }

  private baseLayerResource(document: unknown): ResourceId | null {
    if (!isRecord(document) || !Array.isArray(document.layers)) return null
    for (const layer of document.layers) {
      if (!isRecord(layer) || layer.type !== 'raster' || !isRecord(layer.source)) continue
      const resourceId = layer.source.resourceId
      if (typeof resourceId === 'string' && resourceId.startsWith('sha256:')) return resourceId as ResourceId
    }
    return null
  }

  private async exclusive<T>(documentId: string, operation: () => Promise<T>): Promise<T> {
    return await withFileLock(path.join(this.options.lockDirectory, `${documentId}.lock`), operation, {
      timeoutMessage: '图片文档正被另一个窗口或助手写入，请稍后重试。',
    })
  }
}
