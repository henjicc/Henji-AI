import { requestAlertConfirmation } from '@/stores/alertDialogStore'
import { applicationPaidRequest } from '@/services/paidApproval'
import type { ApplicationRef } from '@/core/application-control'
import { z } from 'zod'
import { createApplicationCallerGrant, revokeApplicationCallerGrant, type ApplicationCallerGrant } from '@/core/application-control/callerContext'
import { ApplicationRevokedReason } from '@/core/application-control/execution/cancelReason'
import { localHostRequestSchema, APPLICATION_CAPABILITY_IDS, APPLICATION_READ_CAPABILITY_IDS, type ApplicationHostPlatform, type LocalHostRequest, type LocalTool } from '@/core/application-control/localHostContracts'
import { createLogger } from '@/core/logging'
import { applicationCallerAccess } from '@/core/application-control/callerContext'
import { getApplicationControlExecutionEngine } from '@/features/application-control/capabilities/applicationControlRegistry'
import { createApplicationCapabilitySession, listApplicationCapabilities } from './applicationCapabilityService'
import { buildExternalCapabilityInventory } from './externalCapabilityInventory'
import { rendererEpoch } from './rendererIdentity'
import { APPLICATION_DOMAINS } from './applicationDomains'
import { bindApplicationConfirmation } from '@/core/application-control/userConfirmation'
import { assertApplicationCallerGrant } from '@/core/application-control/callerContext'
import { agentEditDocumentIds, beginAgentEdit } from './agentEditing'
import { ensureContentTrust } from '@/services/contentTrust'
import { getDocumentOperations, getDocumentSessionRegistry } from '@/features/documents'

const logger = createLogger('features.application_control.host')
// 与宿主附件生命周期分开；发送回执失败或同一渲染器重新连接后，核对仍读原执行事实。
const operationReceipts = new Map<string, { callerId: string; reply: import('@/core/application-control/localHostContracts').LocalHostReply }>()

const openDocumentIds = (): ReadonlySet<string> => new Set(getDocumentSessionRegistry().list().map(session => session.id))

/** 核对读取要读的目标；读取只会为这些目标所在的文档发起打开。自定义验证条件读什么看不出来，不算在内。 */
function reviewTargetIds(request: LocalHostRequest): string[] {
  const ids = request.recoveryVerification?.conditions.flatMap(condition => 'target' in condition ? [condition.target.id] : []) ?? []
  const ref = request.reviewTarget ? request.input.ref as { id?: unknown } | undefined : undefined
  if (typeof ref?.id === 'string') ids.push(ref.id)
  if (request.recoveryOperation?.atomicPlacement) ids.push(request.recoveryOperation.atomicPlacement.documentId)
  return ids
}

/** 引用 ID 里逐段解码后有一段就是这份文档的 ID（各领域把文档 ID 放在不同位置、各自编码）。 */
function targetsDocument(targetIds: readonly string[], documentId: string): boolean {
  return targetIds.some(id => id.split(':').some(part => {
    try { return decodeURIComponent(part) === documentId } catch { return false }
  }))
}

/**
 * 核对读取（重读验证、核对回执、读目标给用户核对）为读一眼在后台打开的文档，读完没人再用：交给各工具的后台释放，
 * 文档在前台编辑、有租约或进行中的任务时拒绝。只放读取开始时还没打开、又正是这次读取目标所在的文档，
 * 用户同时在界面上打开的别的文档不算；读取期间有别的请求在执行，或释放途中来了新请求，就不放或停下，
 * 分不清谁还要用（助手写入后台打开的文档要留着，撤销还归它）。
 */
async function releaseReviewOpened(before: ReadonlySet<string>, targetIds: readonly string[], busy: () => boolean): Promise<void> {
  const opened = getDocumentSessionRegistry().list().filter(session => !before.has(session.id) && targetsDocument(targetIds, session.id))
  if (!opened.length) return
  let released = 0
  for (const session of opened) {
    if (busy()) break
    if (await getDocumentOperations().releaseBackground(session.documentMeta.kind, session.id)) released++
  }
  logger.info('核对读取后台打开的文档已释放', { event: 'documents.session.review_release.completed', context: { opened: opened.length, released } })
}

/** 仅由根宿主通过可信 preload 事件创建授权；网络调用参数不能抵达工厂。 */
export function attachLocalApplicationHost(platform: ApplicationHostPlatform, ready: boolean): () => void {
  const attachmentSequence = performance.timeOrigin + performance.now()
  const grants = new Map<string, ApplicationCallerGrant>()
  const active = new Map<string, AbortController>()
  // 核对读取开始时已登记的会话与读取目标；shared 表示读取期间还有别的请求在执行。
  const reviewWindows = new Map<string, { before: ReadonlySet<string>; targetIds: string[]; shared: boolean }>()
  let disposed = false
  const definitions = listApplicationCapabilities().filter((definition) => APPLICATION_CAPABILITY_IDS.some((id) => id === definition.id))
  const tools = definitions.map((definition): LocalTool => ({
    id: definition.id as LocalTool['id'], version: definition.version, title: definition.title, description: definition.description,
    inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }),
  }))
  // 按域发现与通用写入范围都从真实反射声明派生；宿主注册是它唯一的对外出口。
  const domains = buildExternalCapabilityInventory()
  const unsubscribeRequest = platform.onRequest((raw) => {
    const request = localHostRequestSchema.safeParse(raw)
    if (!request.success || request.data.rendererEpoch !== rendererEpoch || disposed) return
    const { requestId, callerId, capabilityId, input, expectedRevisions } = request.data
    const readOnly = APPLICATION_READ_CAPABILITY_IDS.some((id) => id === capabilityId)
    const action = readOnly ? 'read' : 'write'
    for (const window of reviewWindows.values()) window.shared = true
    if (readOnly && (request.data.recoveryVerification || request.data.recoveryOperation || request.data.reviewTarget)) {
      reviewWindows.set(requestId, { before: openDocumentIds(), targetIds: reviewTargetIds(request.data), shared: active.size > 0 })
    }
    const controller = new AbortController()
    active.set(requestId, controller)
    const unbindConfirmation = bindApplicationConfirmation(controller.signal, async progress => {
      if (progress.phase === 'executing') {
        controller.signal.throwIfAborted()
        const grant = grants.get(requestId)
        if (!grant) throw new Error('操作授权已结束。')
        assertApplicationCallerGrant(grant)
      }
      const reply = { rendererEpoch, requestId, result: { ok: false }, progress }
      if (progress.phase === 'paid_approval') return await platform.complete(reply)
      operationReceipts.set(requestId, { callerId, reply })
      await platform.complete(reply)
      logger.info('应用操作确认状态变化', { event: 'application.confirmation.progress', context: { requestId, phase: progress.phase } })
    }, request.data.paidReceipt)
    const execute = async (): Promise<void> => {
      logger.info(readOnly ? '开始读取应用内容' : '开始修改应用内容', { event: `mcp.${action}.start`, context: { requestId, capabilityId } })
      let result: Record<string, unknown>
      let dispatched = false
      try {
        if (!ready) throw new Error('应用尚未就绪，请稍后重试。')
        const grant = createApplicationCallerGrant({ callerId, operationOrigin: request.data.operationOrigin })
        grants.set(requestId, grant)
        const definition = definitions.find((item) => item.id === capabilityId)
        if (!definition) throw new Error('此读取工具不可用，请重新连接。')
        if (request.data.recoveryOperation && capabilityId !== 'get_current_application_context' && capabilityId !== 'save_video_edit') throw new Error('操作核对只能沿只读宿主或原剪辑保存恢复入口。')
        if (definition.paidGenerationPreparation) {
          const documentRef = input.documentRef as ApplicationRef | undefined
          const destination = input.destination as { mode?: string; documentId?: string } | undefined
          const documentId = typeof input.documentId === 'string' ? input.documentId : documentRef ?? (destination?.mode === 'canvas' ? destination.documentId : undefined)
          await requestAlertConfirmation({ title: definition.title, message: '将使用已配置的模型生成内容。', confirmLabel: '允许本次',
            paid: await applicationPaidRequest('generation', documentId, controller.signal, request.data.paidGenerationEstimate ?? null) }, controller.signal)
        }
        // 编辑提示标出助手当前处理的文档；冲突由领域事务核对。
        const endAgentEdit = !readOnly && request.data.caller
          ? beginAgentEdit(agentEditDocumentIds(definition, input, request.data.operationId ?? requestId), request.data.caller) : undefined
        dispatched = true
        try {
          result = await createApplicationCapabilitySession(grant).execute({ id: capabilityId, version: definition.version, input, expectedRevisions }, { requestId: request.data.operationId ?? requestId, signal: controller.signal })
        } finally { endAgentEdit?.() }
        if (result.ok === true && request.data.reviewTarget && capabilityId === 'read_application_entity') {
          const ref = input.ref as ApplicationRef
          const summary = APPLICATION_DOMAINS.map(domain => domain.reviewTarget?.(ref)).find(Boolean)
          if (summary) result = { ...result, data: { ...result.data as Record<string, unknown>, reviewSummary: summary } }
        }
        if (result.ok === true && request.data.recoveryOperation && capabilityId === 'save_video_edit') {
          let verification: unknown = { verified: false, condition: '保存已完成，原放入尚未核对。' }
          for (const domain of APPLICATION_DOMAINS) {
            const recovered = await domain.recoverOperation?.(request.data.recoveryOperation, applicationCallerAccess(grant, requestId, controller.signal))
            if (recovered?.ok === true) { verification = (recovered.data as Record<string, unknown>).verification; break }
          }
          result = { ...result, data: { ...result.data as Record<string, unknown>, verification } }
        } else if (result.ok === true && request.data.recoveryOperation) {
          const original = request.data.recoveryOperation
          const receipt = operationReceipts.get(original.requestId)
          if (receipt?.callerId === callerId && receipt.reply.rendererEpoch === original.rendererEpoch) {
            result = { ...result, data: { ...result.data as Record<string, unknown>, operationReply: receipt.reply } }
          } else if (original.rendererEpoch !== rendererEpoch) {
            for (const domain of APPLICATION_DOMAINS) {
              const recovered = await domain.recoverOperation?.(original, applicationCallerAccess(grant, requestId, controller.signal))
              if (recovered) {
                const outcome = recovered.ok === true ? { ...recovered,
                  resultingRevision: result.resultingRevision, resultingScopeRevisions: result.resultingScopeRevisions,
                  data: { ...recovered.data as Record<string, unknown>, revision: result.resultingRevision, scopeRevisions: result.resultingScopeRevisions } } : recovered
                result = { ...result, data: { ...result.data as Record<string, unknown>, operationReply: { requestId: original.requestId, rendererEpoch: original.rendererEpoch, result: outcome } } }
                break
              }
            }
          }
        }
        if (result.ok === true && request.data.recoveryVerification) {
          const proof = request.data.recoveryVerification
          const verification = await getApplicationControlExecutionEngine().verifyRecovery(proof.conditions, proof.evidence, applicationCallerAccess(grant, requestId, controller.signal))
            .catch(() => ({ verified: false, evidence: [], unmetConditions: ['保存已确认，但原操作验证尚未完成。'], checkedAt: new Date().toISOString() }))
          result = { ...result, data: { ...result.data as Record<string, unknown>, verification } }
        }
        logger.info(readOnly ? '应用读取结束' : '应用修改结束', { event: `mcp.${action}.completed`, context: { requestId, ok: result.ok, ...(result.ok === false ? { capabilityId, ...failureLogFields(result.error) } : {}) } })
      } catch (error) {
        result = { ok: false, error: { code: 'APPLICATION_EXECUTION_FAILED', message: error instanceof Error ? error.message : '应用操作失败。', ...(!dispatched ? { details: { execution: { notExecuted: true } } } : {}) } }
        logger.warn('应用操作未完成', { event: `mcp.${action}.failed`, context: { requestId, capabilityId, ...failureLogFields(result.error) } })
      }
      const reply = { rendererEpoch, requestId, result }
      if (!readOnly) operationReceipts.set(requestId, { callerId, reply })
      if (!readOnly || (!disposed && !controller.signal.aborted)) await platform.complete(reply)
    }
    void execute().catch((error) => logger.error('发送操作结果失败', error, { event: `mcp.${action}.reply.failed` })).finally(() => {
      unbindConfirmation(); active.delete(requestId); grants.delete(requestId)
      const window = reviewWindows.get(requestId)
      reviewWindows.delete(requestId)
      if (window && !window.shared && !disposed) {
        void releaseReviewOpened(window.before, window.targetIds, () => disposed || active.size > 0).catch(error => logger.warn('核对读取后台打开的文档未能释放', { event: 'documents.session.review_release.failed', error }))
      }
    })
  })
  const unsubscribeCancel = platform.onCancel((id) => active.get(id)?.abort())
  const unsubscribeTrust = platform.onContentTrust(request => {
    void ensureContentTrust(request.query).catch(error => { if (!(error instanceof Error) || error.name !== 'ContentTrustRequiredError') logger.warn('外来内容信任询问未完成', { event: 'content_trust.prompt.failed', error }) })
  })
  const unsubscribeRevoke = platform.onRevoke((id) => { for (const [key, grant] of grants) if (grant.callerId === id) { revokeApplicationCallerGrant(grant); active.get(key)?.abort(new ApplicationRevokedReason()); grants.delete(key) } })
  void platform.registerHost({ rendererEpoch, attachmentSequence, ready, tools, domains }).catch((error) => logger.error('连接应用宿主失败', error, { event: 'mcp.host.register.failed' }))
  return () => {
    disposed = true
    unsubscribeRequest(); unsubscribeCancel(); unsubscribeRevoke(); unsubscribeTrust()
    for (const controller of active.values()) controller.abort()
    for (const grant of grants.values()) revokeApplicationCallerGrant(grant)
    void platform.registerHost({ rendererEpoch, attachmentSequence, ready: false, tools: [], domains: [] }).catch((error) => logger.error('断开应用宿主失败', error, { event: 'mcp.host.disconnect.failed' }))
  }
}

/** 失败的读写都记下错误码与摘要，读取类缺口才能从日志统计出来。 */
function failureLogFields(error: unknown): { errorCode?: string; errorMessage?: string } {
  if (!error || typeof error !== 'object') return {}
  const { code, message } = error as { code?: unknown; message?: unknown }
  return { ...(typeof code === 'string' ? { errorCode: code } : {}), ...(typeof message === 'string' ? { errorMessage: message.slice(0, 300) } : {}) }
}
