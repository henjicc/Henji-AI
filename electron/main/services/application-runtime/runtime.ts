import { ApplicationHostBridge } from './applicationHostBridge'
import { randomUUID } from 'node:crypto'
import type { OperationRecord } from './operationStore'
import { createMainLogger } from '../logging'
import { ApplicationToolDispatcher } from './applicationToolDispatcher'
import { ApplicationOperationCoordinator } from './operationCoordinator'
import { ApplicationOperationStore } from './operationStore'
import { recoverPersistedGenerationOperation, recoverPersistedTranscriptionOperation, recoverPersistedWebReplayOperation, webReplayJobIdOf } from './persistedOperationRecovery'
import { webReplayRenderJobs } from '../web-replay/renderJobs'
import { getAudioEditStoredTask } from '../audio-edit/task-store'
import type { ApplicationAccess } from './toolCatalog'
import { getDb } from '../db'
import { getGenerationHistoryStore } from '../generation-history/store'

const embeddedCallers = new Map<string, ApplicationAccess>()
const attachedEmbeddedCallers = new Set<string>()
const retainedCallers = new Map<string, () => void>()
let externalAuthority: ((id: string) => void) | undefined
let externalName: ((id: string) => string | undefined) | undefined
let runtime: { host: ApplicationHostBridge; operations: ApplicationOperationCoordinator; embedded: ApplicationToolDispatcher; reviewOperation(record: OperationRecord, open?: boolean): Promise<void> } | undefined

/** 应用生命周期持有账本和宿主；协议适配器只提供调用者授权。 */
export function initializeApplicationRuntime() {
  if (runtime) return runtime
  // 恢复回执必须带上 revision/scopeRevisions，否则按 schema 校验的标准 MCP 客户端会拒收整条结果。
  // 原回执没有时用宿主当前快照兜住。
  const currentRevisions = () => {
    const context = host.getContext()
    return context ? { revision: context.revision, scopeRevisions: context.scopeRevisions } : undefined
  }
  const operations: ApplicationOperationCoordinator = new ApplicationOperationCoordinator(new ApplicationOperationStore(getDb()),
    record => recoverPersistedTranscriptionOperation(getAudioEditStoredTask, record)
      // 渲染层还连着、仍在等这次调用时以它的回执为准；主进程用登记重建只在它不在时兜底
      ?? recoverPersistedWebReplayOperation(id => webReplayRenderJobs.get(id), record, currentRevisions, original => host.ready && host.rendererEpoch === original.rendererEpoch)
      ?? recoverPersistedGenerationOperation(id => getGenerationHistoryStore().getStatus(id), record, currentRevisions),
    () => host.writableEntityTypes(), item => host.publishReviews(item))
  const host: ApplicationHostBridge = new ApplicationHostBridge(id => {
    if (embeddedCallers.has(id)) return
    if (!externalAuthority) throw new Error('调用者未获授权。')
    externalAuthority(id)
  }, operations, id => embeddedCallers.has(id) ? { kind: 'embedded' } : { kind: 'external', ...(externalName?.(id) ? { name: externalName(id)!.slice(0, 80) } : {}) })
  const embedded = new ApplicationToolDispatcher({
    assertActive: id => { if (!embeddedCallers.has(id)) throw new Error('助手操作授权已结束。') },
    access: id => { const access = embeddedCallers.get(id); if (!access) throw new Error('助手操作授权已结束。'); return access },
  }, host, operations, 0, 'embedded')
  // 本地用户的只读核验身份由宿主生成，不依赖已经结束的外部连接，也不准许写入或计费。
  const reviewCaller = randomUUID()
  const reviewAccess = { allowWrites: false, allowDestructive: false, allowPaid: false }
  embeddedCallers.set(reviewCaller, reviewAccess)
  const reviewOperation = async (record: OperationRecord, open = true): Promise<void> => {
    const signal = AbortSignal.timeout(30_000)
    try { await embedded.reconcileVerification(reviewCaller, record, signal) }
    catch (error) { createMainLogger('main.application_runtime').warn('自动核对暂不可用，保留待处理项', { event: 'application.confirmation.verify_failed', error }) }
    if (open) {
      const epoch = host.rendererEpoch
      await operations.review(operations.store.get(record.operationId, record.callerId)!, epoch,
        ref => host.execute(reviewCaller, 'read_application_entity', { ref }, signal, { ...reviewAccess, reviewTarget: true }),
        () => { if (!host.ready || host.rendererEpoch !== epoch) throw new Error('应用正在重新连接，请稍后重试。') })
    }
  }
  operations.onChange(() => host.publishReviews())
  // 网页重演在主进程跑，渲染层重载只断了回执：重载后（账本变化时）把仍在跑的标回执行中，重演结束时用登记的
  // 结果结账。重载空档里结束的拿不到宿主修订号，先记下，等新页面发布上下文时再结。result() 只存档、
  // 不触发 onChange，不会循环。登记只在内存：结束后到新页面就绪前应用就退出，这次操作仍是待核对，文件照常在盘上。
  const unsettledReplayJobs = new Set<string>()
  const settleWebReplay = (only?: ReadonlySet<string>): void => {
    try {
      const remaining = new Set<string>()
      for (const record of operations.store.unresolved()) {
        const jobId = webReplayJobIdOf(record)
        if (record.capabilityId !== 'render_web_app_replay' || (only && !only.has(jobId))) continue
        operations.result(record)
        const after = operations.store.get(record.operationId, record.callerId)
        if (after && (after.state === 'executing' || (after.state === 'unknown' && !after.result))) remaining.add(jobId)
      }
      for (const jobId of [...unsettledReplayJobs]) if ((!only || only.has(jobId)) && !remaining.has(jobId)) unsettledReplayJobs.delete(jobId)
    } catch (error) { createMainLogger('main.application_runtime').warn('网页重演结果没能记进操作账本', { event: 'application.web_replay.settle_failed', error }) }
  }
  operations.onChange(() => settleWebReplay())
  webReplayRenderJobs.onSettled(job => { unsettledReplayJobs.add(job.jobId); settleWebReplay(new Set([job.jobId])); host.publishReviews() })
  host.onChange(kind => { if (kind === 'context' && unsettledReplayJobs.size) settleWebReplay(new Set(unsettledReplayJobs)) })
  webReplayRenderJobs.setOwnerResolver(jobId => operations.store.unresolved().find(record => record.capabilityId === 'render_web_app_replay' && webReplayJobIdOf(record) === jobId)?.operationId)
  runtime = { host, operations, embedded, reviewOperation }
  return runtime
}

export function getApplicationRuntime() {
  if (!runtime) throw new Error('应用运行时尚未启动。')
  return runtime
}

export function registerExternalApplicationAuthority(authorize: (id: string) => void, name?: (id: string) => string | undefined): void { externalAuthority = authorize; externalName = name }

export function createEmbeddedApplicationClient(callerId: string, access: ApplicationAccess) {
  const { host, embedded, operations } = getApplicationRuntime()
  if (attachedEmbeddedCallers.has(callerId)) throw new Error('调用者身份已在使用。')
  retainedCallers.get(callerId)?.(); retainedCallers.delete(callerId)
  attachedEmbeddedCallers.add(callerId)
  embeddedCallers.set(callerId, access)
  let closed = false
  const assertOpen = () => { if (closed) throw new Error('助手操作授权已结束。') }
  return {
    catalog: () => { assertOpen(); return embedded.catalog(callerId).tools },
    call: (name: string, input: Record<string, unknown>, signal: AbortSignal) => { assertOpen(); return embedded.call(callerId, name, input, signal) },
    close: () => {
      if (closed) return
      closed = true
      attachedEmbeddedCallers.delete(callerId)
      host.releaseCaller(callerId)
      // A finished model turn does not revoke a committed invocation awaiting the human.
      // Keep its existing access until completion; the next turn may explicitly replace access.
      const release = () => {
        if (operations.store.unresolved().some(record => record.callerId === callerId && ['preparing', 'executing', 'awaiting_user_confirmation'].includes(record.state))) return
        retainedCallers.get(callerId)?.(); retainedCallers.delete(callerId)
        embeddedCallers.delete(callerId)
      }
      retainedCallers.set(callerId, operations.onChange(release))
      release()
    },
  }
}
