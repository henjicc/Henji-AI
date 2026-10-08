import { z } from 'zod'
import { createApplicationCallerGrant, revokeApplicationCallerGrant, type ApplicationCallerGrant } from '@/core/application-control/callerContext'
import { localHostRequestSchema, APPLICATION_CAPABILITY_IDS, APPLICATION_READ_CAPABILITY_IDS, APPLICATION_READ_PERMISSIONS, APPLICATION_WRITE_PERMISSIONS, type ApplicationHostPlatform, type LocalTool } from '@/core/application-control/localHostContracts'
import { createLogger } from '@/core/logging'
import { applicationCallerAccess } from '@/core/application-control/callerContext'
import { getApplicationControlExecutionEngine } from '@/features/application-control/capabilities/applicationControlRegistry'
import { createApplicationCapabilitySession, listApplicationCapabilities } from './applicationCapabilityService'
import { buildExternalCapabilityInventory, externalReflectionPermissions } from './externalCapabilityInventory'
import { rendererEpoch } from './rendererIdentity'
import { APPLICATION_DOMAINS } from './applicationDomains'

const logger = createLogger('features.application_control.host')
// 与宿主附件生命周期分开；发送回执失败或同一渲染器重新连接后，核对仍读原执行事实。
const operationReceipts = new Map<string, { callerId: string; reply: import('@/core/application-control/localHostContracts').LocalHostReply }>()

/** 仅由根宿主通过可信 preload 事件创建授权；网络调用参数不能抵达工厂。 */
export function attachLocalApplicationHost(platform: ApplicationHostPlatform, ready: boolean): () => void {
  const attachmentSequence = performance.timeOrigin + performance.now()
  const grants = new Map<string, ApplicationCallerGrant>()
  const active = new Map<string, AbortController>()
  let disposed = false
  const definitions = listApplicationCapabilities().filter((definition) => APPLICATION_CAPABILITY_IDS.some((id) => id === definition.id))
  const tools = definitions.map((definition): LocalTool => ({
    id: definition.id as LocalTool['id'], version: definition.version, title: definition.title, description: definition.description,
    inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }),
  }))
  // 按域发现与通用写入范围都从真实反射声明派生；宿主注册是它唯一的对外出口。
  const domains = buildExternalCapabilityInventory()
  const permissions = externalReflectionPermissions()
  const unsubscribeRequest = platform.onRequest((raw) => {
    const request = localHostRequestSchema.safeParse(raw)
    if (!request.success || request.data.rendererEpoch !== rendererEpoch || disposed) return
    const { requestId, callerId, capabilityId, input, allowWrites = false, allowDestructive = false, allowPaid = false, expectedRevisions } = request.data
    const readOnly = APPLICATION_READ_CAPABILITY_IDS.some((id) => id === capabilityId)
    const action = readOnly ? 'read' : 'write'
    const controller = new AbortController()
    active.set(requestId, controller)
    const execute = async (): Promise<void> => {
      logger.info(readOnly ? '开始读取应用内容' : '开始修改应用内容', { event: `mcp.${action}.start`, context: { requestId, capabilityId } })
      let result: Record<string, unknown>
      let dispatched = false
      try {
        if (definitions.find(item => item.id === capabilityId)?.paidGenerationPreparation && !allowPaid) throw new Error('此连接没有付费生成授权。')
        if (!ready) throw new Error('应用尚未就绪，请稍后重试。')
        const grant = createApplicationCallerGrant({ callerId, capabilityIds: allowWrites ? [...APPLICATION_CAPABILITY_IDS] : [...APPLICATION_READ_CAPABILITY_IDS], permissions: [...APPLICATION_READ_PERMISSIONS, ...permissions.read, ...(allowWrites ? [...APPLICATION_WRITE_PERMISSIONS, ...permissions.write] : [])], allowWrites, allowDestructive })
        grants.set(requestId, grant)
        const definition = definitions.find((item) => item.id === capabilityId)
        if (!definition) throw new Error('此读取工具不可用，请重新连接。')
        if (request.data.recoveryOperation && capabilityId !== 'get_current_application_context' && capabilityId !== 'save_video_edit') throw new Error('操作核对只能沿只读宿主或原剪辑保存恢复入口。')
        dispatched = true
        result = await createApplicationCapabilitySession(grant).execute({ id: capabilityId, version: definition.version, input, expectedRevisions }, { requestId: request.data.operationId ?? requestId, signal: controller.signal })
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
        logger.info(readOnly ? '应用读取结束' : '应用修改结束', { event: `mcp.${action}.completed`, context: { requestId, ok: result.ok } })
      } catch (error) {
        result = { ok: false, error: { code: 'APPLICATION_EXECUTION_FAILED', message: error instanceof Error ? error.message : '应用操作失败。', ...(!dispatched ? { details: { execution: { notExecuted: true } } } : {}) } }
        logger.warn('应用操作未完成', { event: `mcp.${action}.failed`, context: { requestId } })
      }
      const reply = { rendererEpoch, requestId, result }
      if (!readOnly) operationReceipts.set(requestId, { callerId, reply })
      if (!readOnly || (!disposed && !controller.signal.aborted)) await platform.complete(reply)
    }
    void execute().catch((error) => logger.error('发送操作结果失败', error, { event: `mcp.${action}.reply.failed` })).finally(() => { active.delete(requestId); grants.delete(requestId) })
  })
  const unsubscribeCancel = platform.onCancel((id) => active.get(id)?.abort())
  const unsubscribeRevoke = platform.onRevoke((id) => { for (const [key, grant] of grants) if (grant.callerId === id) { revokeApplicationCallerGrant(grant); grants.delete(key) } })
  void platform.registerHost({ rendererEpoch, attachmentSequence, ready, tools, domains }).catch((error) => logger.error('连接应用宿主失败', error, { event: 'mcp.host.register.failed' }))
  return () => {
    disposed = true
    unsubscribeRequest(); unsubscribeCancel(); unsubscribeRevoke()
    for (const controller of active.values()) controller.abort()
    for (const grant of grants.values()) revokeApplicationCallerGrant(grant)
    void platform.registerHost({ rendererEpoch, attachmentSequence, ready: false, tools: [], domains: [] }).catch((error) => logger.error('断开应用宿主失败', error, { event: 'mcp.host.disconnect.failed' }))
  }
}
