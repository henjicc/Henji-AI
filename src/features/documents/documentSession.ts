import type { DocumentKindDescriptor } from '@/core/documents/kinds'
import type {
  DocumentMeta,
  DocumentReadResult,
  DocumentTarget,
  DocumentTransferResult,
  DocumentUnresolvedLocation,
} from '@/core/documents/types'
import type { Logger } from '@/core/logging/logger'

import {
  DocumentSessionBusyError,
  DocumentSessionClosedError,
  DocumentSessionConflictError,
  isDocumentServiceError,
  toError,
} from './documentErrors'
import type {
  DocumentCommitReason,
  DocumentConflictChoice,
  DocumentContentAdapter,
  DocumentPersistence,
  DocumentReadPurpose,
  DocumentSessionCommands,
  DocumentSessionPrompter,
  DocumentSessionState,
  DocumentSessionStatus,
} from './documentSessionTypes'

/*
 * 一份已打开文档的会话（存储底座 2.4，实施方案 2.8）。
 *
 * 异步落盘的约定：
 * - 内容变化只是内存变化：标脏后防抖保存，期间的多次修改合并成一次写入。
 * - 只有保存成功（含主进程判定 unchanged）才算保存确认；同一文档的写入严格串行。
 * - 关闭、切换与应用退出都等同一个屏障（flush）：取消防抖、等正在写的那次、再写最后一次。
 * - 写入失败保留内存修改，按退避自动重试，也可手动 retry；冲突时暂停自动保存，等用户选择“重新载入 / 覆盖”。
 */

const MAX_FLUSH_ROUNDS = 5

export interface DocumentSessionTiming {
  /** 最后一次修改后多久保存。 */
  autosaveDelayMs: number
  /** 单文件包类型：最后一次保存后空闲多久写回文档文件（工作副本已高频保存，写回整包较重）。 */
  idleCommitDelayMs: number
  retryBaseDelayMs: number
  retryMaxDelayMs: number
}

export const DEFAULT_DOCUMENT_SESSION_TIMING: DocumentSessionTiming = {
  autosaveDelayMs: 800,
  idleCommitDelayMs: 30000,
  retryBaseDelayMs: 2000,
  retryMaxDelayMs: 30000,
}

export interface DocumentSessionInit {
  read: DocumentReadResult
  kind: DocumentKindDescriptor
  persistence: DocumentPersistence
  commands: Pick<DocumentSessionCommands, 'readDocument'>
  prompter: () => DocumentSessionPrompter
  timing: DocumentSessionTiming
  logger: Logger
  onEnded: (session: DocumentSession) => void
}

type Timer = ReturnType<typeof setTimeout>

export class DocumentSession {
  readonly id: string
  readonly kind: DocumentKindDescriptor
  private meta: DocumentMeta
  private missingPaths: readonly string[]
  private unresolved: readonly DocumentUnresolvedLocation[]
  private content: unknown
  private adapter: DocumentContentAdapter | null = null
  private unsubscribeAdapter: (() => void) | null = null
  private receiving = false
  private changeSeq = 0
  private savedSeq = 0
  private status: DocumentSessionStatus = 'saved'
  private error: Error | null = null
  private autosaveTimer: Timer | null = null
  private idleTimer: Timer | null = null
  private retryDelay = 0
  private suspended = false
  private queue: Promise<void> = Promise.resolve()
  private conflictPrompt: Promise<void> | null = null
  private closing: Promise<void> | null = null
  private ended = false
  private readonly listeners = new Set<() => void>()
  private snapshot: DocumentSessionState
  private readonly persistence: DocumentPersistence
  private readonly commands: Pick<DocumentSessionCommands, 'readDocument'>
  private readonly prompter: () => DocumentSessionPrompter
  private readonly timing: DocumentSessionTiming
  private readonly logger: Logger
  private readonly onEnded: (session: DocumentSession) => void

  constructor(init: DocumentSessionInit) {
    this.id = init.read.meta.id
    this.kind = init.kind
    this.meta = init.read.meta
    this.content = init.read.content
    this.missingPaths = init.read.missingPaths
    this.unresolved = init.read.unresolved
    this.persistence = init.persistence
    this.commands = init.commands
    this.prompter = init.prompter
    this.timing = init.timing
    this.logger = init.logger.withContext({ docId: this.id, kind: this.kind.id })
    this.onEnded = init.onEnded
    this.snapshot = this.buildSnapshot()
  }

  /** 供 useSyncExternalStore：同一状态返回同一对象。 */
  getState(): DocumentSessionState {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  get documentMeta(): DocumentMeta {
    return this.meta
  }

  get target(): DocumentTarget {
    return { id: this.meta.id, path: this.meta.path }
  }

  get dirty(): boolean {
    return this.changeSeq !== this.savedSeq
  }

  get isEnded(): boolean {
    return this.ended
  }

  /** 当前内容：附着了工具实例时取实例里的内容，否则取会话自己持有的那份。 */
  getContent(): unknown {
    return this.adapter ? this.adapter.getContent() : this.content
  }

  /** 内容是否为空（草稿离开时判断）；内容不符合类型 schema 时按“不为空”处理，避免误删。 */
  isEmpty(): boolean {
    const content = this.getContent()
    if (this.adapter?.isEmpty) return this.adapter.isEmpty(content)
    const parsed = this.kind.contentSchema.safeParse(content)
    return parsed.success ? this.kind.isEmptyContent(parsed.data) : false
  }

  /** 工具实例接到会话上；返回解除函数（解除时把当前内容留在会话里）。同一时间只能附着一个实例。 */
  attach(adapter: DocumentContentAdapter): () => void {
    if (this.ended) throw new DocumentSessionClosedError()
    if (this.adapter) throw new Error('这份文档已经在另一个窗口中打开。')
    this.adapter = adapter
    this.unsubscribeAdapter = adapter.subscribe(() => this.markChanged())
    return () => {
      if (this.adapter !== adapter) return
      this.content = adapter.getContent()
      this.unsubscribeAdapter?.()
      this.unsubscribeAdapter = null
      this.adapter = null
    }
  }

  /** 没有附着工具实例时直接替换内容并标脏。 */
  update(content: unknown): void {
    if (this.adapter) throw new Error('文档内容由已附着的实例持有，请通过实例修改。')
    this.content = content
    this.markChanged()
  }

  /** 内容有变化：标脏并安排防抖保存。 */
  markChanged(): void {
    if (this.ended || this.receiving) return
    this.changeSeq += 1
    if (this.status === 'saved') this.status = 'pending'
    this.emit()
    if (this.status !== 'conflict' && !this.suspended) this.scheduleAutosave(this.timing.autosaveDelayMs)
  }

  /** 保存屏障：取消防抖，等正在写的那次完成，再把剩余修改写完。冲突时先请用户选择。 */
  async flush(): Promise<void> {
    if (this.ended) return
    this.clearAutosave()
    for (let round = 0; round < MAX_FLUSH_ROUNDS; round += 1) {
      if (this.status === 'conflict') await this.promptConflict()
      try {
        await this.enqueueSave(false)
      } catch (error) {
        // 写入时才发现冲突：下一轮等用户选择后再继续。
        if (this.status === 'conflict') continue
        throw error
      }
      if (!this.dirty && this.status !== 'conflict') return
    }
    throw new DocumentSessionBusyError(this.meta.name)
  }

  /**
   * 写回文档文件（单文件包类型的“保存”与退出屏障）：先写完最后一次，再把工作副本写回文件。
   * JSON 类型没有写回，等同 flush。失败时抛错，修改保留。
   */
  async commit(reason: Exclude<DocumentCommitReason, 'idle'> = 'save'): Promise<void> {
    await this.flush()
    if (!this.persistence.commit || this.ended) return
    this.clearIdleCommit()
    await this.enqueue(() => this.writeBack(reason))
  }

  /**
   * 换位置（移动、转正、创建副本）前的屏障：写完最后一次，再让保存策略把文档引用的内部资源写到位。
   * 没有这一步的类型等同 flush。失败时抛错，修改保留。
   */
  async prepareTransfer(): Promise<void> {
    await this.flush()
    const hook = this.persistence.beforeTransfer
    if (!hook || this.ended) return
    await this.enqueue(async () => {
      const meta = await hook(this.meta)
      if (meta) this.meta = meta
      this.emit()
    })
  }

  /** 失败后手动重试。 */
  retry(): Promise<void> {
    return this.flush()
  }

  /** 冲突处理：重新载入（放弃本地修改）或覆盖（跳过版本核对写入）。 */
  async resolveConflict(choice: Exclude<DocumentConflictChoice, 'later'>): Promise<void> {
    if (choice === 'reload') {
      await this.reload()
      return
    }
    this.clearAutosave()
    await this.enqueueSave(true)
  }

  /** 按磁盘重新载入，放弃内存里的修改。 */
  reload(): Promise<void> {
    return this.enqueue(async () => {
      this.ensureOpen()
      this.clearAutosave()
      const read = await this.readFor('reload', this.target)
      this.applyRead(read)
      this.receiveContent(read.content)
      this.savedSeq = this.changeSeq
      this.error = null
      this.retryDelay = 0
      this.status = 'saved'
      this.logger.info('文档已重新载入', { event: 'documents.session.reload.completed', context: { revision: read.meta.revision } })
      this.emit()
    })
  }

  /** 关闭屏障：写完最后一次（单文件包再写回文档文件）后结束会话。失败时会话保持打开、修改保留。 */
  close(): Promise<void> {
    if (this.ended) return Promise.resolve()
    if (this.closing) return this.closing
    const operation = (async () => {
      await this.flush()
      this.clearIdleCommit()
      if (this.persistence.commit) await this.enqueue(() => this.writeBack('close'))
      await this.end('closed')
    })()
    this.closing = operation
    operation.catch((error: unknown) => {
      if (this.closing === operation) this.closing = null
      this.logger.warn('文档关闭前保存失败，保留修改', { event: 'documents.session.close.failed', error: toError(error) })
    })
    return operation
  }

  /**
   * 草稿转正、移动后套用新的元信息。转正时如果复制了素材、改写了引用（revision 变化），
   * 按新位置重新读取内容交给工具实例。
   */
  async applyTransfer(result: DocumentTransferResult): Promise<void> {
    const previousRevision = this.meta.revision
    await this.enqueue(async () => {
      this.meta = result.meta
      this.emit()
    })
    if (result.meta.revision !== previousRevision) await this.reload()
  }

  /** 所在项目被移动或改名后按 ID 重新定位；磁盘版本没变时只更新位置，不动内容。 */
  relocate(): Promise<void> {
    return this.enqueue(async () => {
      this.ensureOpen()
      const read = await this.readFor('relocate', { id: this.meta.id })
      if (read.meta.revision === this.meta.revision) this.applyRead(read)
      else this.meta = { ...this.meta, path: read.meta.path, name: read.meta.name, container: read.meta.container }
      this.emit()
    })
  }

  /** 暂停自动保存并等正在写的那次完成（丢弃前用）。 */
  async suspend(): Promise<void> {
    this.suspended = true
    this.clearAutosave()
    this.clearIdleCommit()
    await this.queue
  }

  resume(): void {
    if (this.ended || !this.suspended) return
    this.suspended = false
    if (this.dirty && this.status !== 'conflict') this.scheduleAutosave(this.timing.autosaveDelayMs)
  }

  /** 不保存直接结束（文件已删除或移到回收站之后）。 */
  async discard(): Promise<void> {
    await this.suspend()
    await this.end('discarded')
  }

  private async end(reason: 'closed' | 'discarded'): Promise<void> {
    if (this.ended) return
    this.ended = true
    this.clearAutosave()
    this.clearIdleCommit()
    if (this.adapter) this.content = this.adapter.getContent()
    this.unsubscribeAdapter?.()
    this.unsubscribeAdapter = null
    this.adapter = null
    this.status = 'closed'
    this.emit()
    try {
      await this.persistence.dispose?.()
    } catch (error) {
      this.logger.warn('释放文档工作副本失败', { event: 'documents.session.dispose.failed', error: toError(error) })
    }
    this.logger.info('文档会话已结束', { event: `documents.session.${reason}` })
    this.onEnded(this)
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const task = this.queue.then(run)
    this.queue = task.then(() => undefined, () => undefined)
    return task
  }

  private enqueueSave(force: boolean): Promise<void> {
    return this.enqueue(() => this.saveOnce(force))
  }

  private async saveOnce(force: boolean): Promise<void> {
    if (this.ended) return
    if (!force && !this.dirty) return
    if (!force && this.status === 'conflict') throw new DocumentSessionConflictError(this.meta.name)
    const seq = this.changeSeq
    const content = this.getContent()
    this.status = 'saving'
    this.emit()
    const startedAt = Date.now()
    this.logger.debug('开始保存文档', { event: 'documents.session.save.start', context: { force } })
    try {
      const result = await this.persistence.save({
        target: this.target,
        expectedRevision: this.meta.revision,
        content,
        ...(force ? { force: true } : {}),
      })
      this.meta = result.meta
      this.savedSeq = Math.max(this.savedSeq, seq)
      this.error = null
      this.retryDelay = 0
      this.status = this.dirty ? 'pending' : 'saved'
      this.logger.debug('文档已保存', {
        event: 'documents.session.save.completed',
        context: { unchanged: result.unchanged, revision: result.meta.revision, durationMs: Date.now() - startedAt },
      })
      this.emit()
      if (this.dirty && !this.suspended) this.scheduleAutosave(this.timing.autosaveDelayMs)
      if (this.persistence.commit && !this.suspended) this.scheduleIdleCommit()
    } catch (raw) {
      const error = toError(raw)
      this.error = error
      if (isDocumentServiceError(error, 'DocumentRevisionConflictError')) {
        this.status = 'conflict'
        this.logger.warn('文档已在别处被修改', { event: 'documents.session.save.conflict', error })
        this.emit()
        // 自动保存撞上冲突时直接请用户选择；flush 路径会等同一个提示。
        void this.promptConflict().catch(() => undefined)
      } else {
        this.status = 'failed'
        this.retryDelay = this.retryDelay
          ? Math.min(this.timing.retryMaxDelayMs, this.retryDelay * 2)
          : this.timing.retryBaseDelayMs
        this.logger.warn('文档保存失败，修改已保留，将自动重试', {
          event: 'documents.session.save.failed',
          error,
          context: { retryInMs: this.retryDelay },
        })
        this.emit()
        if (!this.suspended) this.scheduleAutosave(this.retryDelay)
      }
      throw error
    }
  }

  /** 按保存策略读取（单文件包类型由策略读取，JSON 类型走文档命令）。 */
  private readFor(purpose: DocumentReadPurpose, target: DocumentTarget): Promise<DocumentReadResult> {
    return this.persistence.read ? this.persistence.read(target, purpose) : this.commands.readDocument(target)
  }

  private async writeBack(reason: DocumentCommitReason): Promise<void> {
    if (!this.persistence.commit) return
    try {
      const meta = await this.persistence.commit(reason, this.meta)
      if (meta) this.meta = meta
      this.emit()
    } catch (raw) {
      const error = toError(raw)
      this.error = error
      this.logger.warn('写回文档文件失败', { event: 'documents.session.commit.failed', error, context: { reason } })
      this.emit()
      throw error
    }
  }

  private promptConflict(): Promise<void> {
    if (!this.conflictPrompt) {
      const prompt = (async () => {
        const choice = await this.prompter().resolveConflict({ name: this.meta.name })
        this.logger.info('冲突处理', { event: 'documents.session.conflict.resolved', context: { choice } })
        if (choice === 'later') throw new DocumentSessionConflictError(this.meta.name)
        await this.resolveConflict(choice)
      })()
      this.conflictPrompt = prompt
      void prompt.finally(() => { if (this.conflictPrompt === prompt) this.conflictPrompt = null }).catch(() => undefined)
    }
    return this.conflictPrompt
  }

  private scheduleAutosave(delay: number): void {
    this.clearAutosave()
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null
      void this.enqueueSave(false).catch(() => undefined)
    }, delay)
  }

  private clearAutosave(): void {
    if (this.autosaveTimer === null) return
    clearTimeout(this.autosaveTimer)
    this.autosaveTimer = null
  }

  private scheduleIdleCommit(): void {
    this.clearIdleCommit()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      void this.enqueue(() => this.writeBack('idle')).catch(() => undefined)
    }, this.timing.idleCommitDelayMs)
  }

  private clearIdleCommit(): void {
    if (this.idleTimer === null) return
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private receiveContent(content: unknown): void {
    if (!this.adapter) {
      this.content = content
      return
    }
    this.receiving = true
    try {
      this.adapter.receiveContent(content)
    } finally {
      this.receiving = false
    }
  }

  private applyRead(read: DocumentReadResult): void {
    this.meta = read.meta
    this.missingPaths = read.missingPaths
    this.unresolved = read.unresolved
  }

  private ensureOpen(): void {
    if (this.ended) throw new DocumentSessionClosedError()
  }

  private buildSnapshot(): DocumentSessionState {
    return {
      meta: this.meta,
      status: this.status,
      dirty: this.dirty,
      error: this.error,
      missingPaths: this.missingPaths,
      unresolved: this.unresolved,
    }
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot()
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        this.logger.warn('文档会话订阅回调出错', { event: 'documents.session.listener.failed', error: toError(error) })
      }
    }
  }
}
