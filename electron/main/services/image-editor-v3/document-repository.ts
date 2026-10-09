import { imageWorkingCopySchema } from '../../../../src/core/persistence/imageSchemas'
import crypto from 'node:crypto'
import { parsePersistenceJson, upgradeStoredFile } from '../persistence/stored-file'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { createMainLogger } from '../logging'
import { writeBufferAtomically } from '../fs/atomic-file'
import { withFileLock } from '../fs/file-lock'
import {
  IMAGE_EDIT_DOCUMENT_FORMAT,
  IMAGE_EDIT_DOCUMENT_REF_PREFIX,
  IMAGE_EDIT_DOCUMENT_VERSION,
  type ImageEditDocumentEnvelope,
  type ImageEditProjectReference,
  type ResourceId,
} from './contracts'
import { ContentAddressedResourceStore, parseResourceId } from './resource-store'
import { KeyedSerialExecutor } from './serial-executor'
import {
  mergePersistedImageEditResourceRefsV3,
  normalizePersistedImageEditDocumentV3,
  normalizePersistedImageEditHistoryV3,
  normalizePersistedImageEditCheckpointV3,
  ImageEditHistoryPageStoreV3,
} from './history-persistence'
import type { ImageEditCommandHistorySnapshotV3 } from '../../../../src/core/imageEdit/v3/commandHistoryCodec'
import type { ImageEditHistoryCheckpointV3 } from '../../../../src/core/imageEdit/v3/historyPaging/checkpoint'

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
  historyCheckpoint?: ImageEditHistoryCheckpointV3
  resourceRefs?: readonly ResourceId[]
  previewRef?: ResourceId
  now?: Date
  signal?: AbortSignal
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
  signal?: AbortSignal
}

export interface ForkDocumentRequest {
  sourceDocumentRef: string
  expectedRevision: number
  targetDocumentId: string
  now?: Date
}

export interface DocumentRepositoryDependencies {
  resources?: ContentAddressedResourceStore
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
    'document', 'history', 'historyCheckpoint', 'resourceRefs', 'previewRef',
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
  const historyCheckpoint = normalizePersistedImageEditCheckpointV3(value.historyCheckpoint, documentId, value.revision as number)
  const refs = mergePersistedImageEditResourceRefsV3(
    document,
    normalizeResourceRefs(value.resourceRefs as ResourceId[]),
    normalizedPreviewRef,
    historyCheckpoint ?? history,
  )
  const result: ImageEditDocumentEnvelope = {
    format: IMAGE_EDIT_DOCUMENT_FORMAT,
    formatVersion: IMAGE_EDIT_DOCUMENT_VERSION,
    documentId,
    revision: value.revision as number,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    document,
    ...(history ? { history } : {}),
    ...(historyCheckpoint ? { historyCheckpoint } : {}),
    resourceRefs: refs,
    previewRef: normalizedPreviewRef,
  }
  const { history: _runtimeHistory, ...persisted } = result
  imageWorkingCopySchema.parse(persisted)
  return result
}

function serializeEnvelope(envelope: ImageEditDocumentEnvelope): Buffer {
  const { history: _runtimeHistory, ...persisted } = envelope
  return Buffer.from(`${JSON.stringify(persisted)}\n`, 'utf8')
}

export function toDocumentRef(documentId: string): `image-edit-v3:${string}` {
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
  private readonly resources: ContentAddressedResourceStore
  private readonly historyPages: ImageEditHistoryPageStoreV3

  constructor(
    readonly rootDir: string,
    dependencies: DocumentRepositoryDependencies = {},
  ) {
    this.writeAtomically = dependencies.writeAtomically ?? writeBufferAtomically
    this.resources = dependencies.resources ?? new ContentAddressedResourceStore(path.join(rootDir, '.history-resources'))
    this.historyPages = new ImageEditHistoryPageStoreV3(this.resources)
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
        historyCheckpoint: normalizePersistedImageEditCheckpointV3(request.historyCheckpoint, documentId, revision),
        resourceRefs: [],
        previewRef: request.previewRef,
      }
      envelope.resourceRefs = mergePersistedImageEditResourceRefsV3(
        document,
        normalizeResourceRefs(request.resourceRefs ?? []),
        envelope.previewRef,
        envelope.historyCheckpoint ?? envelope.history,
      )
      await this.persist(envelope, 'create', request.signal)
      return envelope
    }))
  }

  async load(documentIdOrRef: string): Promise<ImageEditDocumentEnvelope> {
    const envelope = await this.loadCheckpoint(documentIdOrRef)
    if (envelope.historyCheckpoint) envelope.history = await this.historyPages.restore(envelope.historyCheckpoint)
    return envelope
  }

  /** 保存、目录扫描与 GC 只读检查点，不把历史命令全部载入。 */
  async loadCheckpoint(documentIdOrRef: string): Promise<ImageEditDocumentEnvelope> {
    const documentId = documentIdOrRef.startsWith(IMAGE_EDIT_DOCUMENT_REF_PREFIX)
      ? parseDocumentRef(documentIdOrRef)
      : validateDocumentId(documentIdOrRef)
    const targetPath = this.documentPath(documentId)
    const stats = await fsp.stat(targetPath)
    if (!stats.isFile() || stats.size > this.maxDocumentBytes) {
      throw new Error(`Invalid image edit document size: ${stats.size}`)
    }
    const text = await fsp.readFile(targetPath, 'utf8')
    const raw = parsePersistenceJson(text, 'image-working-copy')
    const upgraded = await upgradeStoredFile(targetPath, 'image-working-copy', raw, isRecord(raw) ? raw.formatVersion : 0, text)
    const envelope = validateImageEditDocumentEnvelope(upgraded)
    if (envelope.documentId !== documentId) throw new Error('Image edit document id does not match file name')
    return envelope
  }

  async save(request: SaveDocumentRequest): Promise<ImageEditDocumentEnvelope> {
    const documentId = validateDocumentId(request.documentId)
    return this.executor.run(documentId, () => this.withDocumentLock(documentId, async () => {
      const current = await this.loadCheckpoint(documentId)
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
        historyCheckpoint: undefined,
        resourceRefs: mergePersistedImageEditResourceRefsV3(
          document,
          normalizeResourceRefs(request.resourceRefs).filter(ref => !current.historyCheckpoint?.pages.some(page => page.resourceId === ref)),
          request.previewRef,
          history,
        ),
        previewRef: request.previewRef,
      }
      await this.persist(envelope, 'save', request.signal)
      return envelope
    }))
  }

  /**
   * 从调用方已确认的精确 revision 建立独立文档与历史头。
   * 像素与历史资源均为内容寻址不可变对象，因此这里只复制引用，不复制字节。
   */
  async fork(request: ForkDocumentRequest): Promise<ImageEditDocumentEnvelope> {
    const targetDocumentId = validateDocumentId(request.targetDocumentId)
    const source = await this.loadCheckpoint(request.sourceDocumentRef)
    if (source.revision !== request.expectedRevision) {
      throw new DocumentRevisionConflictError(
        source.documentId,
        request.expectedRevision,
        source.revision,
      )
    }
    if (!isRecord(source.document)) {
      throw new Error(`Invalid image edit document body for fork: ${source.documentId}`)
    }
    return this.create({
      documentId: targetDocumentId,
      revision: source.revision,
      document: { ...source.document, id: targetDocumentId },
      history: source.history
        ? { ...source.history, documentId: targetDocumentId }
        : undefined,
      historyCheckpoint: source.historyCheckpoint ? { ...source.historyCheckpoint, documentId: targetDocumentId } : undefined,
      resourceRefs: source.resourceRefs,
      previewRef: source.previewRef,
      now: request.now,
    })
  }

  /**
   * 整份替换（不存在时新建）：图片文档打开时把 `.henjiimg` 的内容解到工作副本（3.5）。
   * 只给图片文档服务用；它保证此时没有编辑中的实例持有这份文档。
   */
  async replace(envelope: ImageEditDocumentEnvelope): Promise<ImageEditDocumentEnvelope> {
    const validated = validateImageEditDocumentEnvelope(envelope)
    return this.executor.run(validated.documentId, () => this.withDocumentLock(validated.documentId, async () => {
      await this.persist(validated, 'replace')
      return validated
    }))
  }

  async list(): Promise<ImageEditDocumentEnvelope[]> {
    const entries = await fsp.readdir(this.rootDir, { withFileTypes: true }).catch((error: unknown) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
      throw error
    })
    const envelopes: ImageEditDocumentEnvelope[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const documentId = entry.name.slice(0, -'.json'.length)
      try {
        envelopes.push(await this.loadCheckpoint(documentId))
      } catch (error) {
        logger.error('图片编辑文档根扫描失败', {
          event: 'image_editor_v3.document.list.failed',
          context: { documentId },
          error,
        })
        throw error
      }
    }
    return envelopes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /** 发现文档只读取目录，不把整份文档及媒体资源加载进主进程。 */
  async listReferences(cursor: string | undefined, limit: number): Promise<{ documentRefs: `image-edit-v3:${string}`[]; nextCursor: string | null }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid document list limit')
    const afterId = cursor === undefined ? undefined : parseDocumentRef(cursor)
    const entries = await fsp.readdir(this.rootDir, { withFileTypes: true }).catch((error: unknown) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
      throw error
    })
    const ids = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -5))
      .filter((id) => DOCUMENT_ID_PATTERN.test(id) && (afterId === undefined || id > afterId)).sort()
    const documentRefs = ids.slice(0, limit).map(toDocumentRef)
    return { documentRefs, nextCursor: ids.length > limit ? documentRefs[documentRefs.length - 1] : null }
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
        current = await this.loadCheckpoint(documentId)
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

  private async persist(envelope: ImageEditDocumentEnvelope, action: 'create' | 'save' | 'replace', signal?: AbortSignal): Promise<void> {
    logger.info('开始保存图片编辑文档', {
      event: `image_editor_v3.document.${action}.start`,
      context: { documentId: envelope.documentId, revision: envelope.revision },
    })
    let release: (() => Promise<void>) | undefined
    try {
      if (envelope.history) {
        const prepared = await this.historyPages.prepare(envelope.history, signal)
        release = prepared.release
        const previousPages = new Set(envelope.historyCheckpoint?.pages.map(page => page.resourceId))
        envelope.historyCheckpoint = prepared.checkpoint
        envelope.resourceRefs = normalizeResourceRefs([...envelope.resourceRefs.filter(ref => !previousPages.has(ref)), ...prepared.resourceIds])
      } else if (envelope.historyCheckpoint) {
        const lease = await this.resources.acquireLease(envelope.resourceRefs)
        release = () => lease.release()
        await this.historyPages.validate(envelope.historyCheckpoint, signal)
      }
      const { history: _runtimeHistory, ...persisted } = envelope
      imageWorkingCopySchema.parse(persisted)
      const serialized = serializeEnvelope(envelope)
      if (serialized.byteLength > this.maxDocumentBytes) {
        throw new Error(`Image edit document exceeds ${this.maxDocumentBytes} byte limit`)
      }
      signal?.throwIfAborted()
      await this.resources.publishReferences(async () => {
        signal?.throwIfAborted()
        await this.writeAtomically(this.documentPath(envelope.documentId), serialized)
      })
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
    } finally { await release?.() }
  }

  private async withDocumentLock<T>(documentId: string, operation: () => Promise<T>): Promise<T> {
    return await withFileLock(path.join(this.rootDir, '.locks', `${documentId}.lock`), operation, {
      timeoutMs: DOCUMENT_LOCK_TIMEOUT_MS,
      staleMs: DOCUMENT_LOCK_STALE_MS,
      timeoutMessage: `Timed out acquiring document lock: ${documentId}`,
    })
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
