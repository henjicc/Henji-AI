import type { ApplicationHostBridge } from './applicationHostBridge'
import { UNRESOLVED_OPERATION_STATES, type ApplicationOperationStore, type OperationRecord } from './operationStore'
import { operationVerificationRecovery } from './operationVerificationRecovery'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.application_runtime')

/**
 * 界面连续这么久没有发布上下文、没有宿主请求进出，才复核下一条。启动和页面重载后的首屏与文档恢复会接连发布上下文；
 * 复核在渲染层读取目标时会打开文档，等这些停下再做，不和用户抢 IPC 与磁盘。
 */
export const AUTO_REVIEW_QUIET_MS = 5_000

type DocumentRevision = (documentId: string) => number | undefined

/**
 * 引用所属的文档及其已保存修订号。各领域把文档 ID 放在引用 ID 的不同位置并各自编码（剪辑、画布是 `文档:子对象`，
 * 图片编辑是 `v3:编码后的文档ID:图层`），对应的解析函数都在渲染层领域模块里，主进程不能引用；这里逐段解码，
 * 只认作品索引里确有的文档 ID，不按位置猜。
 */
function referencedDocument(ref: { id: string }, revision: DocumentRevision): [string, number] | undefined {
  for (const part of ref.id.split(':')) {
    let id: string
    try { id = decodeURIComponent(part) } catch { continue }
    const value = revision(id)
    if (value !== undefined) return [id, value]
  }
  return undefined
}

/**
 * 写入目标与验证条件目标所在文档的已保存修订号。查不到文档的目标（设置、素材、模型等）没有已保存修订号可比，
 * 这类记录读完一次后只在状态变化时再自动复核，其余留给用户在核对界面打开。
 */
function targetDocumentRevisions(record: OperationRecord, revision: DocumentRevision): Record<string, number> {
  const conditions = operationVerificationRecovery(record)?.conditions ?? []
  const refs = [...record.targetRefs ?? [], ...conditions.flatMap(condition => 'target' in condition ? [condition.target] : [])]
  const revisions: Record<string, number> = {}
  for (const ref of refs) {
    const document = referencedDocument(ref, revision)
    if (document) revisions[document[0]] = document[1]
  }
  return revisions
}

/**
 * 从没读完过、读完后状态变了，或目标所在文档在那之后保存过（含删除、找不到），才需要再自动复核。
 * 只能核对回执的记录同样按文档修订号判断：放入结果这类回执是从已保存的剪辑里重建的，剪辑保存后才拿得到。
 */
export function autoReviewDue(record: OperationRecord, revision: DocumentRevision): boolean {
  const marker = record.autoReview
  if (!marker || marker.state !== record.state) return true
  const current = targetDocumentRevisions(record, revision)
  const ids = Object.keys(current)
  return ids.length !== Object.keys(marker.documentRevisions).length || ids.some(id => marker.documentRevisions[id] !== current[id])
}

/** 宿主注册就绪后在界面空闲时自动复核未结操作；只核对回执与重读验证，不重放任何写入，结账仍由协调器按核对结果决定。 */
export function createOperationAutoReview(options: {
  host: ApplicationHostBridge
  store: Pick<ApplicationOperationStore, 'unresolved' | 'get' | 'save'>
  /** 返回回执与重读验证是否真正读完；没读完（超时、出错、中途换了渲染会话）不记记号，下次注册再试。 */
  review(record: OperationRecord): Promise<boolean>
  documentRevision: DocumentRevision
}): { schedule(rendererEpoch: string): Promise<void> } {
  const { host, store, documentRevision } = options
  let scheduled: string | undefined
  let running: Promise<void> | undefined
  const unresolved = (record: OperationRecord | undefined): record is OperationRecord => !!record && UNRESOLVED_OPERATION_STATES.includes(record.state)
  const quiet = async (epoch: string): Promise<boolean> => {
    for (;;) {
      if (!host.ready || host.rendererEpoch !== epoch) return false
      const wait = host.lastActivityAt + AUTO_REVIEW_QUIET_MS - Date.now()
      if (wait <= 0) return true
      await new Promise<void>(resolve => { setTimeout(resolve, wait).unref?.() })
    }
  }
  const run = async (epoch: string): Promise<void> => {
    const requestedAt = Date.now()
    let reviewed = 0, incomplete = 0, skipped = 0, interrupted = false, started = false
    for (const listed of store.unresolved()) {
      if (!autoReviewDue(listed, documentRevision)) { skipped++; continue }
      if (!await quiet(epoch)) { interrupted = true; break }
      const record = store.get(listed.operationId, listed.callerId)
      if (!unresolved(record) || !autoReviewDue(record, documentRevision)) continue
      if (!started) {
        started = true
        logger.info('界面空闲，开始自动复核未结操作', { event: 'application.operation.auto_review.started', context: { waitedMs: Date.now() - requestedAt } })
      }
      if (!await options.review(record)) { incomplete++; continue }
      reviewed++
      const current = store.get(record.operationId, record.callerId)
      if (unresolved(current)) store.save({ ...current, autoReview: { state: current.state, documentRevisions: targetDocumentRevisions(current, documentRevision) } })
    }
    logger.info('自动复核结束', { event: 'application.operation.auto_review.completed', context: { reviewed, incomplete, skipped, interrupted, durationMs: Date.now() - requestedAt } })
  }
  return {
    /** 同一时间只跑一轮；换了渲染会话的注册排在当前这轮之后，当前这轮发现会话变了就停。 */
    schedule(rendererEpoch) {
      scheduled = rendererEpoch
      running ??= (async () => {
        try {
          while (scheduled) {
            const epoch = scheduled
            scheduled = undefined
            try { await run(epoch) } catch (error) { logger.warn('恢复核对未完成', { event: 'application.confirmation.restore_failed', error }) }
          }
        } finally { running = undefined }
      })()
      return running
    },
  }
}
