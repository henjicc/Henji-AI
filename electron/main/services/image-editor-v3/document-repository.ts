import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { createMainLogger } from '../logging'
import { writeBufferAtomically } from './atomic-file'
import {
  IMAGE_EDIT_DOCUMENT_FORMAT,
  IMAGE_EDIT_DOCUMENT_REF_PREFIX,
  IMAGE_EDIT_DOCUMENT_VERSION,
  type ImageEditDocumentEnvelope,
  type ImageEditProjectReference,
  type ResourceId,
} from './contracts'
import { parseResourceId } from './resource-store'
import { KeyedSerialExecutor } from './serial-executor'
import {
  mergePersistedImageEditResourceRefsV3,
  normalizePersistedImageEditDocumentV3,
  normalizePersistedImageEditHistoryV3,
} from './history-persistence'
import type { ImageEditCommandHistorySnapshotV3 } from '../../../../src/core/imageEdit/v3/commandHistoryCodec'

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024
const DOCUMENT_LOCK_TIMEOUT_MS = 5_000
const DOCUMENT_LOCK_STALE_MS = 30_000
const logger = createMainLogger('main.image_editor_v3.documents')

export class DocumentRevisionConflictError extends Error {
  constructor(
    readonly documentId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Document revision conflict for ${documentId}: expected ${expectedRevision}, actual ${actualRevision}`)
    this.name = 'DocumentRevisionConflictError'
  }
}

export interface CreateDocumentRequest {
  documentId?: string
  revision?: number
  document: unknown
  history?: ImageEditCommandHistorySnapshotV3 | null
  resourceRefs?: readonly ResourceId[]
  previewRef?: ResourceId
  now?: Date
}

export interface SaveDocumentRequest {
  documentId: string
  expectedRevision: number
  /** 合并多条命令后允许 revision 跳跃，但必须严格大于磁盘 revision。 */
  nextRevision?: number
  document: unknown
  history?: ImageEditCommandHistorySnapshotV3 | null
  resourceRefs: readonly ResourceId[]
  previewRef?: ResourceId
  now?: Date
}

export interface DocumentRepositoryDependencies {
  writeAtomically?: (targetPath: string, content: Uint8Array) => Promise<void>
  maxDocumentBytes?: number
}

function validateDocumentId(documentId: string): string {
  if (!DOCUMENT_ID_PATTERN.test(documentId)) throw new Error(`Invalid image edit document id: ${documentId}`)
  return documentId
}

function normalizeResourceRefs(resourceRefs: readonly ResourceId[]): ResourceId[] {
  const unique = new Set<ResourceId>()
  for (const resourceId of resourceRefs) {
    parseResourceId(resourceId)
    unique.add(resourceId)
  }
  return [...unique].sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateImageEditDocumentEnvelope(value: unknown): ImageEditDocumentEnvelope {
  if (!isRecord(value)) throw new Error('Invalid image edit document: expected object')
  const allowedKeys = new Set([
    'format', 'formatVersion', 'documentId', 'revision', 'createdAt', 'updatedAt',
    'document', 'history', 'resourceRefs', 'previewRef',
  ])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error('Invalid image edit document: unknown field')
  }
  if (value.format !== IMAGE_EDIT_DOCUMENT_FORMAT || value.formatVersion !== IMAGE_EDIT_DOCUMENT_VERSION) {
    throw new Error('Unsupported image edit document format')
  }
  if (typeof value.documentId !== 'string') throw new Error('Invalid image edit document id')
  const documentId = validateDocumentId(value.documentId)
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    throw new Error('Invalid image edit document revision')
  }
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') {
    throw new Error('Invalid image edit document timestamps')
  }
  if (!Array.isArray(value.resourceRefs) || !value.resourceRefs.every((item) => typeof item === 'string')) {
    throw new Error('Invalid image edit document resource references')
  }
  const previewRef = value.previewRef
  if (previewRef !== undefined && typeof previewRef !== 'string') {
    throw new Error('Invalid image edit document preview reference')
  }
  const normalizedPreviewRef = previewRef as ResourceId | undefined
  if (normalizedPreviewRef) parseResourceId(normalizedPreviewRef)
  const document = normalizePersistedImageEditDocumentV3(
    value.document,
    documentId,
    value.revision as number,
  )
  const history = normalizePersistedImageEditHistoryV3(
    value.history,
    document,
    documentId,
    value.revision as number,
  )
  const refs = mergePersistedImageEditResourceRefsV3(
    document,
    normalizeResourceRefs(value.resourceRefs as ResourceId[]),
    normalizedPreviewRef,
    history,
  )
  return {
    format: IMAGE_EDIT_DOCUMENT_FORMAT,
    formatVersion: IMAGE_EDIT_DOCUMENT_VERSION,
    documentId,
    revision: value.revision as number,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    document,
    ...(history ? { history } : {}),
    resourceRefs: refs,
    previewRef: normalizedPreviewRef,
  }
}

function serializeEnvelope(envelope: ImageEditDocumentEnvelope): Buffer {
  return Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8')
}

export function toDocumentRef(documentId: string): string {
  return `${IMAGE_EDIT_DOCUMENT_REF_PREFIX}${validateDocumentId(documentId)}`
}

export function parseDocumentRef(documentRef: string): string {
  if (!documentRef.startsWith(IMAGE_EDIT_DOCUMENT_REF_PREFIX)) {
    throw new Error(`Invalid image edit document reference: ${documentRef}`)
  }
  return validateDocumentId(documentRef.slice(IMAGE_EDIT_DOCUMENT_REF_PREFIX.length))
}

export function toProjectReference(envelope: ImageEditDocumentEnvelope): ImageEditProjectReference {
  return {
    documentRef: toDocumentRef(envelope.documentId),
    revision: envelope.revision,
    previewRef: envelope.previewRef,
  }
}

export class ImageEditDocumentRepository {
  private readonly executor = new KeyedSerialExecutor()
  private readonly writeAtomically: (targetPath: string, content: Uint8Array) => Promise<void>
  private readonly maxDocumentBytes: number

  constructor(
    readonly rootDir: string,
    dependencies: DocumentRepositoryDependencies = {},
  ) {
    this.writeAtomically = dependencies.writeAtomically ?? writeBufferAtomically
    this.maxDocumentBytes = dependencies.maxDocumentBytes ?? MAX_DOCUMENT_BYTES
    if (!Number.isSafeInteger(this.maxDocumentBytes) || this.maxDocumentBytes < 1) {
      throw new Error('Invalid image edit document byte limit')
    }
  }

  private documentPath(documentId: string): string {
    return path.join(this.rootDir, `${validateDocumentId(documentId)}.json`)
  }

  async create(request: CreateDocumentRequest): Promise<ImageEditDocumentEnvelope> {
    const documentId = validateDocumentId(request.documentId ?? crypto.randomUUID())
    return this.executor.run(documentId, () => this.withDocumentLock(documentId, async () => {
      const targetPath = this.documentPath(documentId)
      const exists = await fsp.access(targetPath).then(() => true).catch(() => false)
      if (exists) throw new Error(`Image edit document already exists: ${documentId}`)
      const timestamp = (request.now ?? new Date()).toISOString()
      const revision = request.revision ?? 0
      if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new Error(`Invalid initial document revision: ${revision}`)
      }
      const document = normalizePersistedImageEditDocumentV3(
        request.document,
        documentId,
        revision,
      )
      const envelope: ImageEditDocumentEnvelope = {
        format: IMAGE_EDIT_DOCUMENT_FORMAT,
        formatVersion: IMAGE_EDIT_DOCUMENT_VERSION,
        documentId,
        revision,
        createdAt: timestamp,
        updatedAt: timestamp,
        document,
        history: normalizePersistedImageEditHistoryV3(
          request.history,
          document,
          documentId,
          revision,
        ),
        resourceRefs: [],
        previewRef: request.previewRef,
      }
      envelope.resourceRefs = mergePersistedImageEditResourceRefsV3(
        document,
        normalizeResourceRefs(request.resourceRefs ?? []),
        envelope.previewRef,
        envelope.history,
      )
      await this.persist(envelope, 'create')
      return envelope
    }))
  }

  async load(documentIdOrRef: string): Promise<ImageEditDocumentEnvelope> {
    const documentId = documentIdOrRef.startsWith(IMAGE_EDIT_DOCUMENT_REF_PREFIX)
      ? parseDocumentRef(documentIdOrRef)
      : validateDocumentId(documentIdOrRef)
    const targetPath = this.documentPath(documentId)
    const stats = await fsp.stat(targetPath)
    if (!stats.isFile() || stats.size > this.maxDocumentBytes) {
      throw new Error(`Invalid image edit document size: ${stats.size}`)
    }
    const envelope = validateImageEditDocumentEnvelope(JSON.parse(await fsp.readFile(targetPath, 'utf8')) as unknown)
    if (envelope.documentId !== documentId) throw new Error('Image edit document id does not match file name')
    return envelope
  }

  async save(request: SaveDocumentRequest): Promise<ImageEditDocumentEnvelope> {
    const documentId = validateDocumentId(request.documentId)
    return this.executor.run(documentId, () => this.withDocumentLock(documentId, async () => {
      const current = await this.load(documentId)
      if (current.revision !== request.expectedRevision) {
        throw new DocumentRevisionConflictError(documentId, request.expectedRevision, current.revision)
      }
      const nextRevision = request.nextRevision ?? current.revision + 1
      if (!Number.isSafeInteger(nextRevision) || nextRevision < current.revision) {
        throw new Error(`Invalid next document revision: ${nextRevision}`)
      }
      const document = normalizePersistedImageEditDocumentV3(
        request.document,
        documentId,
        nextRevision,
      )
      if (nextRevision === current.revision
        && JSON.stringify(document) !== JSON.stringify(current.document)) {
        throw new Error('Document content changed without advancing revision')
      }
      const history = normalizePersistedImageEditHistoryV3(
        request.history,
        document,
        documentId,
        nextRevision,
      )
      const envelope: ImageEditDocumentEnvelope = {
        ...current,
        revision: nextRevision,
        updatedAt: (request.now ?? new Date()).toISOString(),
        document,
        history,
        resourceRefs: mergePersistedImageEditResourceRefsV3(
          document,
          normalizeResourceRefs(request.resourceRefs),
          request.previewRef,
          history,
        ),
        previewRef: request.previewRef,
      }
      await this.persist(envelope, 'save')
      return envelope
    }))
  }

  async list(): Promise<ImageEditDocumentEnvelope[]> {
    const entries = await fsp.readdir(this.rootDir, { withFileTypes: true }).catch(() => [])
    const envelopes: ImageEditDocumentEnvelope[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const documentId = entry.name.slice(0, -'.json'.length)
      try {
        envelopes.push(await this.load(documentId))
      } catch (error) {
        logger.warn('跳过损坏的图片编辑文档', {
          event: 'image_editor_v3.document.list.skipped',
          context: { documentId },
          error,
        })
      }
    }
    return envelopes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * 仅供跨文件事务补偿：只有文档仍处于调用方刚写入的 revision 时才删除，
   * 避免回滚覆盖随后发生的用户编辑。
   */
  async deleteIfRevision(documentIdOrRef: string, expectedRevision: number): Promise<boolean> {
    const documentId = documentIdOrRef.startsWith(IMAGE_EDIT_DOCUMENT_REF_PREFIX)
      ? parseDocumentRef(documentIdOrRef)
      : validateDocumentId(documentIdOrRef)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error(`Invalid expected document revision: ${expectedRevision}`)
    }
    return this.executor.run(documentId, () => this.withDocumentLock(documentId, async () => {
      let current: ImageEditDocumentEnvelope
      try {
        current = await this.load(documentId)
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
        throw error
      }
      if (current.revision !== expectedRevision) return false
      await fsp.rm(this.documentPath(documentId), { force: true })
      return true
    }))
  }

  createAutosaveScheduler(delayMs = 500): DocumentAutosaveScheduler {
    return new DocumentAutosaveScheduler(this, delayMs)
  }

  private async persist(envelope: ImageEditDocumentEnvelope, action: 'create' | 'save'): Promise<void> {
    logger.info('开始保存图片编辑文档', {
      event: `image_editor_v3.document.${action}.start`,
      context: { documentId: envelope.documentId, revision: envelope.revision },
    })
    try {
      const serialized = serializeEnvelope(envelope)
      if (serialized.byteLength > this.maxDocumentBytes) {
        throw new Error(`Image edit document exceeds ${this.maxDocumentBytes} byte limit`)
      }
      await this.writeAtomically(this.documentPath(envelope.documentId), serialized)
      logger.info('图片编辑文档保存完成', {
        event: `image_editor_v3.document.${action}.completed`,
        context: { documentId: envelope.documentId, revision: envelope.revision },
      })
    } catch (error) {
      logger.error('图片编辑文档保存失败', {
        event: `image_editor_v3.document.${action}.failed`,
        context: { documentId: envelope.documentId, revision: envelope.revision },
        error,
      })
      throw error
    }
  }

  private async withDocumentLock<T>(documentId: string, operation: () => Promise<T>): Promise<T> {
    const lockDir = path.join(this.rootDir, '.locks')
    const lockPath = path.join(lockDir, `${documentId}.lock`)
    await fsp.mkdir(lockDir, { recursive: true })
    const deadline = Date.now() + DOCUMENT_LOCK_TIMEOUT_MS
    let lock: fsp.FileHandle | undefined
    while (!lock) {
      try {
        const candidate = await fsp.open(lockPath, 'wx', 0o600)
        try {
          await candidate.writeFile(`${process.pid} ${Date.now()}\n`, 'utf8')
          lock = candidate
        } catch (error) {
          await candidate.close().catch(() => undefined)
          await fsp.rm(lockPath, { force: true }).catch(() => undefined)
          throw error
        }
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
        const stats = await fsp.stat(lockPath).catch(() => undefined)
        if (stats && Date.now() - stats.mtimeMs > DOCUMENT_LOCK_STALE_MS) {
          await fsp.rm(lockPath, { force: true }).catch(() => undefined)
          continue
        }
        if (Date.now() >= deadline) throw new Error(`Timed out acquiring document lock: ${documentId}`)
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
      }
    }
    try {
      return await operation()
    } finally {
      await lock.close().catch(() => undefined)
      await fsp.rm(lockPath, { force: true }).catch(() => undefined)
    }
  }
}

interface AutosaveWaiter {
  resolve: (envelope: ImageEditDocumentEnvelope) => void
  reject: (error: unknown) => void
}

export class DocumentAutosaveScheduler {
  private timer: NodeJS.Timeout | undefined
  private pendingRequest: SaveDocumentRequest | undefined
  private pendingWaiters: AutosaveWaiter[] = []
  private inFlight: Promise<ImageEditDocumentEnvelope | null> | undefined
  private documentId: string | undefined

  constructor(
    private readonly repository: ImageEditDocumentRepository,
    private readonly delayMs = 500,
  ) {}

  schedule(request: SaveDocumentRequest): Promise<ImageEditDocumentEnvelope> {
    if (this.documentId !== undefined && this.documentId !== request.documentId) {
      throw new Error(`Autosave scheduler is already bound to document: ${this.documentId}`)
    }
    this.documentId = request.documentId
    this.pendingRequest = request
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush().catch(() => undefined)
    }, Math.max(0, this.delayMs))
    return new Promise((resolve, reject) => {
      this.pendingWaiters.push({ resolve, reject })
    })
  }

  async flush(): Promise<ImageEditDocumentEnvelope | null> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.inFlight) {
      await this.inFlight.catch(() => null)
      return this.flush()
    }
    if (!this.pendingRequest) return null
    const request = this.pendingRequest
    const waiters = this.pendingWaiters
    this.pendingRequest = undefined
    this.pendingWaiters = []
    this.inFlight = this.repository.save(request)
      .then((envelope) => {
        for (const waiter of waiters) waiter.resolve(envelope)
        return envelope
      })
      .catch((error: unknown) => {
        for (const waiter of waiters) waiter.reject(error)
        throw error
      })
      .finally(() => {
        this.inFlight = undefined
      })
    return this.inFlight
  }

  cancel(reason: unknown = new Error('Autosave cancelled')): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.pendingRequest = undefined
    this.documentId = undefined
    const waiters = this.pendingWaiters
    this.pendingWaiters = []
    for (const waiter of waiters) waiter.reject(reason)
  }
}
