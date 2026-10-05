import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

import type { DocumentContainerRef } from '../../../../../src/core/documents/types'
import { replaceFileAtomically, writeBufferAtomically } from '../../fs/atomic-file'
import type { MainLogger } from '../../logging/main-logger'
import type { ImageEditDocumentEnvelope } from '../contracts'
import type { ImageEditDocumentRepository } from '../document-repository'
import type { HenjiImagePackageCodec } from '../package-codec'
import { stagedPackagePathFor } from '../package-export'
import { withImageEditDocumentId } from '../image-document/header'
import { readPackageDocumentHeaderBytes } from '../image-document/package-file'

/*
 * 画布多图层节点的内嵌图片文档（3.4）。
 *
 * 编辑仍发生在程序目录 V3 文档仓库里的工作副本；画布写回时把每份内嵌文档打成单文件包，放进画布所在容器的
 * `.henji/canvas-layers/<文档ID>.henjilayer`，画布内容的 layerPackages 记下位置。于是：
 * - 移进 / 移出项目：通用移动把画布引用的 `.henji` 文件一起复制到新容器；
 * - 创建副本、拷贝整个项目文件夹：副本画布 ID 不同，打开时按包（或工作副本）分出一份新文档，节点改指向它，
 *   两边各改各的；
 * - 换一台机器：没有工作副本时按包解出来。
 *
 * 程序目录 `canvas-layer-links/<文档ID>.json` 记下这份工作副本属于哪份画布、最后一次写出的包与版本，
 * 用来判断“这次是不是副本”“包是不是最新的”。只存程序内部状态；删掉只会让下次打开按包重新判断。
 * 不在用的包不自动清理（节点删掉后包留在 `.henji/` 里）。
 */

export const CANVAS_LAYER_PACKAGE_EXTENSION = '.henjilayer'
export const CANVAS_LAYER_FOLDER_NAME = 'canvas-layers'
const HEADER_FORMAT = 'henji-canvas-layer'
const HEADER_VERSION = 1
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export interface CanvasLayerLink {
  documentId: string
  /** 这份工作副本属于哪份画布（画布文档 ID）。 */
  ownerCanvasId: string
  /** 最后一次写出 / 解出的包与当时的文件样子；没有写过时为 null。 */
  packagePath: string | null
  fileSize: number
  fileModifiedAt: number
  /** 那时工作副本的版本。 */
  committedWorkingRevision: number
}

interface CanvasLayerHeader {
  format: typeof HEADER_FORMAT
  version: number
  documentId: string
  contentRevision: number
}

export interface CanvasLayerPrepareRequest {
  canvasId: string
  layers: ReadonlyArray<{ documentId: string; packagePath?: string }>
}

export interface CanvasLayerPrepareResult {
  /** 副本分出的新文档：旧文档 ID → 新文档 ID（画布节点要改指向新的）。 */
  rewrites: Record<string, string>
  /** 既没有工作副本也找不到包的文档。 */
  missing: string[]
}

export interface CanvasLayerCommitRequest {
  canvasId: string
  container: DocumentContainerRef
  documentIds: readonly string[]
}

export interface CanvasLayerCommitResult {
  /** 文档 ID → 包的位置（只含成功写出或已是最新的）。 */
  packages: Record<string, string>
  written: number
}

export interface CanvasLayerPackageServiceOptions {
  documents: ImageEditDocumentRepository
  packages: HenjiImagePackageCodec
  linksDirectory: string
  logger: MainLogger
  validateDocument(envelope: ImageEditDocumentEnvelope): void
  /** 容器的 `.henji` 文件夹（用到时才建并设为隐藏）。 */
  resolveInternalFolder(container: DocumentContainerRef): Promise<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : undefined
}

function assertDocumentId(documentId: string): string {
  if (!DOCUMENT_ID_PATTERN.test(documentId)) throw new Error(`内嵌图片文档 ID 无效：${documentId}`)
  return documentId
}

/** 副本分出的新文档 ID：由画布 ID 与原文档 ID 决定，重复打开（还没来得及保存）时得到同一个。 */
export function forkedCanvasLayerDocumentId(canvasId: string, documentId: string): string {
  return `canvas-layer-${createHash('sha256').update(`${canvasId}\n${documentId}`).digest('hex').slice(0, 32)}`
}

export class CanvasLayerLinks {
  constructor(private readonly directory: string) {}

  private file(documentId: string): string {
    return path.join(this.directory, `${assertDocumentId(documentId)}.json`)
  }

  async read(documentId: string): Promise<CanvasLayerLink | null> {
    let raw: string
    try {
      raw = await fsp.readFile(this.file(documentId), 'utf8')
    } catch {
      return null
    }
    try {
      const value = JSON.parse(raw) as unknown
      if (!isRecord(value) || value.documentId !== documentId || typeof value.ownerCanvasId !== 'string' || !value.ownerCanvasId) return null
      const packagePath = typeof value.packagePath === 'string' && path.isAbsolute(value.packagePath) ? value.packagePath : null
      const fileSize = nonNegative(value.fileSize)
      const fileModifiedAt = nonNegative(value.fileModifiedAt)
      const committedWorkingRevision = typeof value.committedWorkingRevision === 'number' && Number.isSafeInteger(value.committedWorkingRevision)
        ? value.committedWorkingRevision
        : null
      if (fileSize === null || fileModifiedAt === null || committedWorkingRevision === null) return null
      return { documentId, ownerCanvasId: value.ownerCanvasId, packagePath, fileSize, fileModifiedAt, committedWorkingRevision }
    } catch {
      return null
    }
  }

  async write(link: CanvasLayerLink): Promise<void> {
    await writeBufferAtomically(this.file(link.documentId), Buffer.from(`${JSON.stringify(link)}\n`, 'utf8'))
  }
}

export class CanvasLayerPackageService {
  readonly links: CanvasLayerLinks

  constructor(private readonly options: CanvasLayerPackageServiceOptions) {
    this.links = new CanvasLayerLinks(options.linksDirectory)
  }

  private get logger(): MainLogger {
    return this.options.logger
  }

  /**
   * 画布打开时：确保每份内嵌文档在本机有属于这份画布的工作副本。
   * - 工作副本属于这份画布（或还没有归属）：直接用；包比工作副本新且工作副本没有未写出的修改时按包更新。
   * - 工作副本属于别的画布（创建副本、拷贝文件夹）：按包（没有包时按工作副本）分出新文档。
   * - 没有工作副本：按包解出来。
   */
  async prepare(request: CanvasLayerPrepareRequest): Promise<CanvasLayerPrepareResult> {
    const rewrites: Record<string, string> = {}
    const missing: string[] = []
    for (const layer of request.layers) {
      const id = assertDocumentId(layer.documentId)
      const packagePath = layer.packagePath && path.isAbsolute(layer.packagePath) ? layer.packagePath : null
      const working = await this.loadWorking(id)
      const link = await this.links.read(id)
      const header = packagePath ? await this.readHeader(packagePath) : null
      if (working && (!link || link.ownerCanvasId === request.canvasId)) {
        const packageIsNewer = header !== null && header.documentId === id && header.contentRevision > working.revision
          && link !== null && link.committedWorkingRevision === working.revision
        if (packageIsNewer && packagePath) {
          await this.importInto(id, packagePath, request.canvasId)
        } else if (!link) {
          await this.links.write({ documentId: id, ownerCanvasId: request.canvasId, packagePath: null, fileSize: 0, fileModifiedAt: 0, committedWorkingRevision: -1 })
        }
        continue
      }
      if (working && link) {
        const forkedId = forkedCanvasLayerDocumentId(request.canvasId, id)
        const existing = await this.loadWorking(forkedId)
        if (!existing) {
          if (header && packagePath) {
            await this.importInto(forkedId, packagePath, request.canvasId)
          } else {
            const forked = await this.options.documents.fork({ sourceDocumentRef: id, targetDocumentId: forkedId, expectedRevision: working.revision })
            await this.links.write({ documentId: forkedId, ownerCanvasId: request.canvasId, packagePath: null, fileSize: 0, fileModifiedAt: 0, committedWorkingRevision: -1 })
            this.logger.info('画布副本的内嵌图片文档已按工作副本分出', { event: 'canvas_layers.prepare.forked', context: { documentId: id, forkedId, revision: forked.revision } })
          }
        }
        rewrites[id] = forkedId
        continue
      }
      if (header && packagePath) {
        await this.importInto(id, packagePath, request.canvasId)
        continue
      }
      missing.push(id)
    }
    if (missing.length) {
      this.logger.warn('画布内嵌图片文档既没有工作副本也找不到包', { event: 'canvas_layers.prepare.missing', context: { canvasId: request.canvasId, count: missing.length } })
    }
    return { rewrites, missing }
  }

  /** 画布写回时：把每份内嵌文档写成容器 `.henji/canvas-layers/` 里的包；已是最新的不写。 */
  async commit(request: CanvasLayerCommitRequest): Promise<CanvasLayerCommitResult> {
    const packages: Record<string, string> = {}
    let written = 0
    if (request.documentIds.length === 0) return { packages, written }
    const folder = path.join(await this.options.resolveInternalFolder(request.container), CANVAS_LAYER_FOLDER_NAME)
    await fsp.mkdir(folder, { recursive: true })
    for (const rawId of request.documentIds) {
      const id = assertDocumentId(rawId)
      const working = await this.loadWorking(id)
      if (!working) {
        this.logger.warn('内嵌图片文档的工作副本不在，跳过写出', { event: 'canvas_layers.commit.working_missing', context: { canvasId: request.canvasId, documentId: id } })
        continue
      }
      const target = path.join(folder, `${id}${CANVAS_LAYER_PACKAGE_EXTENSION}`)
      const link = await this.links.read(id)
      const owner = link?.ownerCanvasId ?? request.canvasId
      const stat = await fsp.stat(target).catch(() => null)
      if (stat?.isFile() && link && link.packagePath === target && link.fileSize === stat.size
        && link.fileModifiedAt === stat.mtimeMs && link.committedWorkingRevision === working.revision) {
        packages[id] = target
        continue
      }
      if (stat?.isFile()) {
        // 移动时随画布复制过来的包，或上次写出后记录丢了：内容版本对得上就只更新记录
        const header = await this.readHeader(target)
        if (header?.documentId === id && header.contentRevision === working.revision) {
          await this.links.write({ documentId: id, ownerCanvasId: owner, packagePath: target, fileSize: stat.size, fileModifiedAt: stat.mtimeMs, committedWorkingRevision: working.revision })
          packages[id] = target
          continue
        }
      }
      try {
        await this.writePackage(working, target)
        const after = await fsp.stat(target)
        await this.links.write({ documentId: id, ownerCanvasId: owner, packagePath: target, fileSize: after.size, fileModifiedAt: after.mtimeMs, committedWorkingRevision: working.revision })
        packages[id] = target
        written += 1
      } catch (error) {
        this.logger.error('内嵌图片文档写出失败', { event: 'canvas_layers.commit.failed', context: { canvasId: request.canvasId, documentId: id }, error })
        throw error
      }
    }
    if (written) {
      this.logger.info('画布内嵌图片文档已写出', { event: 'canvas_layers.commit.completed', context: { canvasId: request.canvasId, written, total: request.documentIds.length } })
    }
    return { packages, written }
  }

  private async writePackage(working: ImageEditDocumentEnvelope, target: string): Promise<void> {
    const header: CanvasLayerHeader = { format: HEADER_FORMAT, version: HEADER_VERSION, documentId: working.documentId, contentRevision: working.revision }
    const stagedPath = stagedPackagePathFor(target)
    try {
      await this.options.packages.writeStaged({ document: working, documentHeader: `${JSON.stringify(header)}\n` }, stagedPath)
      await replaceFileAtomically(stagedPath, target)
    } finally {
      await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
    }
  }

  private async importInto(documentId: string, packagePath: string, canvasId: string): Promise<void> {
    const imported = await this.options.packages.import(packagePath)
    try {
      if (imported.missingExternalSources.length > 0) throw new Error('内嵌图片文档引用了不在包里的外部图片。')
      const envelope = withImageEditDocumentId(imported.manifest.document, documentId)
      this.options.validateDocument(envelope)
      const working = await this.options.documents.replace(envelope)
      const stat = await fsp.stat(packagePath)
      await this.links.write({ documentId, ownerCanvasId: canvasId, packagePath, fileSize: stat.size, fileModifiedAt: stat.mtimeMs, committedWorkingRevision: working.revision })
      this.logger.info('画布内嵌图片文档已按包解出', { event: 'canvas_layers.prepare.imported', context: { canvasId, documentId, revision: working.revision } })
    } finally {
      await imported.resourceLease.release()
    }
  }

  private async readHeader(packagePath: string): Promise<CanvasLayerHeader | null> {
    try {
      const bytes = await readPackageDocumentHeaderBytes(packagePath)
      if (!bytes) return null
      const value = JSON.parse(bytes.toString('utf8')) as unknown
      if (!isRecord(value) || value.format !== HEADER_FORMAT || typeof value.documentId !== 'string') return null
      const contentRevision = value.contentRevision
      if (typeof contentRevision !== 'number' || !Number.isSafeInteger(contentRevision) || contentRevision < 0) return null
      return { format: HEADER_FORMAT, version: typeof value.version === 'number' ? value.version : HEADER_VERSION, documentId: value.documentId, contentRevision }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        this.logger.warn('内嵌图片文档包无法读取', { event: 'canvas_layers.header.invalid', context: { packagePath }, error })
      }
      return null
    }
  }

  private async loadWorking(documentId: string): Promise<ImageEditDocumentEnvelope | null> {
    try {
      const envelope = await this.options.documents.load(documentId)
      this.options.validateDocument(envelope)
      return envelope
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        this.logger.warn('内嵌图片文档工作副本无法读取', { event: 'canvas_layers.working.invalid', context: { documentId }, error })
      }
      return null
    }
  }
}
