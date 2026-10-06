import {
  commitImageEditorV3ImageDocument,
  createImageEditorV3ImageDocument,
  createImageEditorV3RequestId,
  describeImageEditorV3ImageDocument,
  openImageEditorV3ImageDocument,
} from '@/commands/imageEditorV3'
import type {
  CreateDocumentRequest,
  DocumentMeta,
  DocumentReadResult,
  DocumentSaveResult,
  DocumentTarget,
  SaveDocumentRequest,
} from '@/core/documents/types'
import { createLogger } from '@/core/logging'
import type {
  DocumentCommitReason,
  DocumentPersistence,
  DocumentReadPurpose,
} from '@/features/documents/documentSessionTypes'
import type {
  ImageEditorV3ImageDocumentReady,
  ImageEditorV3ImageDocumentRecoveryRequired,
  ImageEditorV3ImageDocumentWorking,
  ImageEditorV3PackageThumbnail,
} from '@/platform/contracts/imageEditorV3'

/*
 * 图片文档（`.henjiimg`）的单文件包保存策略（3.5，接入 2.4 文档会话）：
 *
 * - 打开 / 新建 / 重新读取都由主进程图片文档服务完成（通用仓库不读写包内容）。
 * - save：把编辑器里还没落盘的修改写进程序目录的工作副本（编辑器本身已按 500ms 高频保存，
 *   这里只是保存屏障）。
 * - commit：保存、空闲（会话 30 秒无新保存）、关闭与退出时把工作副本整包原子写回 `.henjiimg`。
 * - 冲突：写回时发现文件已在别处被改过 → 记下冲突并请会话再保存一次，会话据此弹“重新载入 / 覆盖”；
 *   覆盖 = 下一次写回跳过版本核对；重新载入 = 按文件重新解包，放弃工作副本里的修改。
 */

const logger = createLogger('features.imageEdit.document_persistence')

export type ImageDocumentRecoveryChoice = 'restore' | 'discard' | 'cancel'

/** 图片文档写回成功（文件内容真的变了）：剪辑里链接这份图片文档的片段据此重新渲染（4.1）。 */
export interface ImageDocumentCommitEvent {
  documentId: string
  meta: DocumentMeta
  reason: DocumentCommitReason
}
const commitListeners = new Set<(event: ImageDocumentCommitEvent) => void>()

/** 订阅图片文档写回；返回取消订阅函数。 */
export function onImageDocumentCommitted(listener: (event: ImageDocumentCommitEvent) => void): () => void {
  commitListeners.add(listener)
  return () => { commitListeners.delete(listener) }
}

export interface ImageDocumentRecoveryInfo {
  name: string
  workingSavedAt: number
  fileSavedAt: number
}

/** 编辑器（或后台实例）接到策略上的部分。 */
export interface ImageDocumentWorkingHooks {
  /** 把还没落盘的修改写进工作副本。 */
  flush(): Promise<void>
  /** 当前合成预览的缩略图（写回时作为包内缩略图与列表封面）；没有时返回 null。 */
  thumbnail?(): (ImageEditorV3PackageThumbnail & { extension: 'png' | 'webp' }) | null
  /** 重新载入前调用：编辑器放下这份文档的内存实例，避免旧内容再写回工作副本。 */
  beforeReload?(): Promise<void>
}

export class ImageDocumentOpenCancelledError extends Error {
  constructor() {
    super('已取消打开图片文档。')
    this.name = 'AbortError'
  }
}

function conflictError(name: string): Error {
  const error = new Error(`“${name}”已在别处被修改。`)
  error.name = 'DocumentRevisionConflictError'
  return error
}

export interface ImageDocumentPersistenceOptions {
  /** 工作副本有没写回的修改时如何处理；省略时按“恢复工作副本”处理（后台打开不丢修改）。 */
  chooseRecovery?(info: ImageDocumentRecoveryInfo): Promise<ImageDocumentRecoveryChoice>
  /** 新建时由调用方先建好的工作副本（V3 文档 ID 即文档 ID）。 */
  pendingCreate?: { documentId: string; emptyUntilRevision: number | null }
}

export class ImageDocumentPersistence implements DocumentPersistence {
  readonly mode = 'package' as const
  private hooks: ImageDocumentWorkingHooks | null = null
  private metaSource: (() => DocumentMeta) | null = null
  private requestSave: (() => void) | null = null
  private lastMeta: DocumentMeta | null = null
  private lastWorking: ImageEditorV3ImageDocumentWorking | null = null
  private lastImported = false
  private conflicted = false
  private forceNextCommit = false
  private readonly listeners = new Set<(working: ImageEditorV3ImageDocumentWorking) => void>()

  constructor(private readonly options: ImageDocumentPersistenceOptions = {}) {}

  /** 最近一次打开或重新载入时的工作副本。 */
  get working(): ImageEditorV3ImageDocumentWorking | null {
    return this.lastWorking
  }

  /** 最近一次打开是按文件重新解包的。 */
  get imported(): boolean {
    return this.lastImported
  }

  setHooks(hooks: ImageDocumentWorkingHooks | null): void {
    this.hooks = hooks
  }

  /** 会话建好后接上：保存结果要带会话当前的元信息（转正、改名后的位置）；冲突时请会话再保存一次。 */
  bindSession(binding: { meta(): DocumentMeta; requestSave(): void }): void {
    this.metaSource = binding.meta
    this.requestSave = binding.requestSave
  }

  /** 重新载入（冲突后）换了工作副本时通知编辑器重新挂载。 */
  onWorkingReplaced(listener: (working: ImageEditorV3ImageDocumentWorking) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async read(target: DocumentTarget, purpose: DocumentReadPurpose): Promise<DocumentReadResult> {
    if (purpose === 'relocate') {
      const described = await describeImageEditorV3ImageDocument({ requestId: createImageEditorV3RequestId('image-document-describe'), target })
      return this.accept(described).read
    }
    if (purpose === 'reload') {
      await this.hooks?.beforeReload?.()
      const reopened = await this.openWith(target, 'discard')
      this.conflicted = false
      this.forceNextCommit = false
      const ready = this.accept(reopened)
      for (const listener of [...this.listeners]) listener(ready.working)
      return ready.read
    }
    const first = await this.openWith(target, 'ask')
    if (first.status === 'ready') return this.accept(first).read
    const choice = this.options.chooseRecovery
      ? await this.options.chooseRecovery({ name: first.meta.name, workingSavedAt: first.workingSavedAt, fileSavedAt: first.fileSavedAt })
      : 'restore'
    logger.info('图片文档恢复选择', { event: 'image_document.recovery.choice', context: { documentId: first.meta.id, choice } })
    if (choice === 'cancel') throw new ImageDocumentOpenCancelledError()
    const second = await this.openWith(target, choice)
    if (second.status !== 'ready') throw new Error('图片文档恢复状态异常，请重试。')
    return this.accept(second).read
  }

  async create(request: CreateDocumentRequest): Promise<DocumentReadResult> {
    const pending = this.options.pendingCreate
    if (!pending) throw new Error('新建图片文档需要先准备好图片内容。')
    const created = await createImageEditorV3ImageDocument({
      requestId: createImageEditorV3RequestId('image-document-create'),
      documentId: pending.documentId,
      container: request.container,
      emptyUntilRevision: pending.emptyUntilRevision,
    })
    return this.accept(created).read
  }

  async save(request: SaveDocumentRequest): Promise<DocumentSaveResult> {
    if (request.force) {
      this.conflicted = false
      this.forceNextCommit = true
    } else if (this.conflicted) {
      throw conflictError(this.currentMeta().name)
    }
    await this.hooks?.flush()
    return { meta: this.currentMeta(), unchanged: false }
  }

  async commit(reason: DocumentCommitReason, meta: DocumentMeta): Promise<DocumentMeta> {
    const force = this.forceNextCommit
    const thumbnail = this.hooks?.thumbnail?.() ?? null
    try {
      const result = await commitImageEditorV3ImageDocument({
        requestId: createImageEditorV3RequestId('image-document-commit'),
        target: { id: meta.id, path: meta.path },
        expectedRevision: meta.revision,
        ...(force ? { force: true } : {}),
        ...(thumbnail ? { thumbnail } : {}),
      })
      this.forceNextCommit = false
      this.lastMeta = result.meta
      logger.debug('图片文档写回完成', { event: 'image_document.commit.completed', context: { documentId: meta.id, reason, unchanged: result.unchanged } })
      if (!result.unchanged) {
        for (const listener of [...commitListeners]) {
          try { listener({ documentId: meta.id, meta: result.meta, reason }) } catch (error) {
            logger.warn('图片文档写回通知处理失败', { event: 'image_document.commit.listener_failed', error, context: { documentId: meta.id } })
          }
        }
      }
      return result.meta
    } catch (error) {
      if (error instanceof Error && error.name === 'DocumentRevisionConflictError') {
        this.conflicted = true
        logger.warn('图片文档写回时发现文件已在别处被修改', { event: 'image_document.commit.conflict', context: { documentId: meta.id, reason } })
        // 请会话再保存一次：保存会以冲突失败，会话据此弹出“重新载入 / 覆盖”。
        this.requestSave?.()
      }
      throw error
    }
  }

  private currentMeta(): DocumentMeta {
    const meta = this.metaSource?.() ?? this.lastMeta
    if (!meta) throw new Error('图片文档尚未打开。')
    return meta
  }

  private openWith(target: DocumentTarget, recovery: 'ask' | 'restore' | 'discard'): Promise<ImageEditorV3ImageDocumentReady | ImageEditorV3ImageDocumentRecoveryRequired> {
    return openImageEditorV3ImageDocument({ requestId: createImageEditorV3RequestId('image-document-open'), target, recovery })
  }

  private accept(ready: ImageEditorV3ImageDocumentReady | ImageEditorV3ImageDocumentRecoveryRequired): ImageEditorV3ImageDocumentReady {
    if (ready.status !== 'ready') throw new Error('图片文档尚未准备好。')
    this.lastMeta = ready.read.meta
    this.lastWorking = ready.working
    this.lastImported = ready.imported
    return ready
  }
}
