import { z } from 'zod'
import { createApplicationCallerGrant, revokeApplicationCallerGrant, type ApplicationCallerGrant } from '@/core/application-control/callerContext'
import { localHostRequestSchema, MCP_CAPABILITY_IDS, MCP_READ_CAPABILITY_IDS, MCP_READ_PERMISSIONS, MCP_WRITE_PERMISSIONS, type McpPlatform, type LocalTool } from '@/core/application-control/localHostContracts'
import { createLogger } from '@/core/logging'
import { applicationCallerAccess } from '@/core/application-control/callerContext'
import { getApplicationControlExecutionEngine } from '@/features/assistant/applicationCapabilities/applicationControlRegistry'
import { createApplicationCapabilitySession, listApplicationCapabilities } from './applicationCapabilityService'

const logger = createLogger('features.application_control.host')

/** 仅由根宿主通过可信 preload 事件创建授权；网络调用参数不能抵达工厂。 */
export function attachLocalApplicationHost(platform: McpPlatform, ready: boolean): () => void {
  const sessionId = crypto.randomUUID()
  const generation = performance.timeOrigin + performance.now()
  const grants = new Map<string, ApplicationCallerGrant>()
  const active = new Map<string, AbortController>()
  let disposed = false
  const definitions = listApplicationCapabilities().filter((definition) => MCP_CAPABILITY_IDS.some((id) => id === definition.id))
  const tools = definitions.map((definition): LocalTool => ({
    id: definition.id as LocalTool['id'], version: definition.version, title: definition.title, description: definition.description,
    inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }),
  }))
  const unsubscribeRequest = platform.onRequest((raw) => {
    const request = localHostRequestSchema.safeParse(raw)
    if (!request.success || request.data.sessionId !== sessionId || disposed) return
    const { requestId, callerId, capabilityId, input, allowWrites = false, allowDestructive = false, allowPaid = false, expectedRevisions } = request.data
    const readOnly = MCP_READ_CAPABILITY_IDS.some((id) => id === capabilityId)
    const action = readOnly ? 'read' : 'write'
    const controller = new AbortController()
    active.set(requestId, controller)
    const execute = async (): Promise<void> => {
      logger.info(readOnly ? '开始读取应用内容' : '开始修改应用内容', { event: `mcp.${action}.start`, context: { requestId, capabilityId } })
      let result: Record<string, unknown>
      try {
        if (capabilityId === 'create_visible_generation_task' && !allowPaid) throw new Error('此连接没有付费生成授权。')
        if (!ready) throw new Error('应用尚未就绪，请稍后重试。')
        const grant = createApplicationCallerGrant({ callerId, capabilityIds: allowWrites ? [...MCP_CAPABILITY_IDS] : [...MCP_READ_CAPABILITY_IDS], permissions: [...MCP_READ_PERMISSIONS, ...(allowWrites ? MCP_WRITE_PERMISSIONS : [])], allowWrites, allowDestructive })
        grants.set(requestId, grant)
        const definition = definitions.find((item) => item.id === capabilityId)
        if (!definition) throw new Error('此读取工具不可用，请重新连接。')
        result = await createApplicationCapabilitySession(grant).execute({ id: capabilityId, version: definition.version, input, expectedRevisions }, { requestId: request.data.operationId ?? requestId, signal: controller.signal })
        if (result.ok === true && request.data.recoveryVerification) {
          const proof = request.data.recoveryVerification
          const verification = await getApplicationControlExecutionEngine().verifyRecovery(proof.conditions, proof.evidence, applicationCallerAccess(grant, requestId, controller.signal))
            .catch(() => ({ verified: false, evidence: [], unmetConditions: ['保存已确认，但原操作验证尚未完成。'], checkedAt: new Date().toISOString() }))
          result = { ...result, data: { ...result.data as Record<string, unknown>, verification } }
        }
        logger.info(readOnly ? '应用读取结束' : '应用修改结束', { event: `mcp.${action}.completed`, context: { requestId, ok: result.ok } })
      } catch (error) {
        result = { ok: false, error: { code: 'APPLICATION_EXECUTION_FAILED', message: error instanceof Error ? error.message : '应用操作失败。' } }
        logger.warn('应用操作未完成', { event: `mcp.${action}.failed`, context: { requestId } })
      }
      if (!MCP_READ_CAPABILITY_IDS.some((id) => id === capabilityId) || (!disposed && !controller.signal.aborted)) await platform.complete({ sessionId, requestId, result })
    }
    void execute().catch((error) => logger.error('发送操作结果失败', error, { event: `mcp.${action}.reply.failed` })).finally(() => { active.delete(requestId); grants.delete(requestId) })
  })
  const unsubscribeCancel = platform.onCancel((id) => active.get(id)?.abort())
  const unsubscribeRevoke = platform.onRevoke((id) => { for (const [key, grant] of grants) if (grant.callerId === id) { revokeApplicationCallerGrant(grant); grants.delete(key) } })
  void platform.registerHost({ sessionId, generation, ready, tools }).catch((error) => logger.error('连接应用宿主失败', error, { event: 'mcp.host.register.failed' }))
  return () => {
    disposed = true
    unsubscribeRequest(); unsubscribeCancel(); unsubscribeRevoke()
    for (const controller of active.values()) controller.abort()
    for (const grant of grants.values()) revokeApplicationCallerGrant(grant)
    void platform.registerHost({ sessionId, generation, ready: false, tools: [] }).catch((error) => logger.error('断开应用宿主失败', error, { event: 'mcp.host.disconnect.failed' }))
  }
}
