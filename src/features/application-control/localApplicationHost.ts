import { z } from 'zod'
import { createApplicationCallerGrant, revokeApplicationCallerGrant, type ApplicationCallerGrant } from '@/core/application-control/callerContext'
import { localHostRequestSchema, MCP_READ_CAPABILITY_IDS, MCP_READ_PERMISSIONS, type McpPlatform, type LocalTool } from '@/core/application-control/localHostContracts'
import { createLogger } from '@/core/logging'
import { createApplicationCapabilitySession, listApplicationCapabilities } from './applicationCapabilityService'

const logger = createLogger('features.application_control.host')

/** 仅由根宿主通过可信 preload 事件创建授权；网络调用参数不能抵达工厂。 */
export function attachLocalApplicationHost(platform: McpPlatform, ready: boolean): () => void {
  const sessionId = crypto.randomUUID()
  const generation = performance.timeOrigin + performance.now()
  const grants = new Map<string, ApplicationCallerGrant>()
  const active = new Map<string, AbortController>()
  let disposed = false
  const definitions = listApplicationCapabilities().filter((definition) => MCP_READ_CAPABILITY_IDS.some((id) => id === definition.id) && definition.readOnly)
  const tools = definitions.map((definition): LocalTool => ({
    id: definition.id as LocalTool['id'], version: definition.version, title: definition.title, description: definition.description,
    inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }),
  }))
  const unsubscribeRequest = platform.onRequest((raw) => {
    const request = localHostRequestSchema.safeParse(raw)
    if (!request.success || request.data.sessionId !== sessionId || disposed) return
    const { requestId, callerId, capabilityId, input } = request.data
    const controller = new AbortController()
    active.set(requestId, controller)
    const execute = async (): Promise<void> => {
      logger.info('开始读取应用内容', { event: 'mcp.read.start', context: { requestId, capabilityId } })
      let result: Record<string, unknown>
      try {
        if (!ready) throw new Error('应用尚未就绪，请稍后重试。')
        let grant = grants.get(callerId)
        if (!grant) {
          grant = createApplicationCallerGrant({ callerId, capabilityIds: [...MCP_READ_CAPABILITY_IDS], permissions: [...MCP_READ_PERMISSIONS], allowWrites: false, allowDestructive: false })
          grants.set(callerId, grant)
        }
        const definition = definitions.find((item) => item.id === capabilityId)
        if (!definition) throw new Error('此读取工具不可用，请重新连接。')
        result = await createApplicationCapabilitySession(grant).execute({ id: capabilityId, version: definition.version, input }, { requestId, signal: controller.signal })
        logger.info('应用读取结束', { event: 'mcp.read.completed', context: { requestId, ok: result.ok } })
      } catch (error) {
        result = { ok: false, error: { code: 'APPLICATION_READ_FAILED', message: error instanceof Error ? error.message : '应用读取失败。' } }
        logger.warn('应用读取未完成', { event: 'mcp.read.failed', context: { requestId } })
      }
      if (!disposed && !controller.signal.aborted) await platform.complete({ sessionId, requestId, result })
    }
    void execute().catch((error) => logger.error('发送读取结果失败', error, { event: 'mcp.read.reply.failed' })).finally(() => active.delete(requestId))
  })
  const unsubscribeCancel = platform.onCancel((id) => active.get(id)?.abort())
  const unsubscribeRevoke = platform.onRevoke((id) => { const grant = grants.get(id); if (grant) revokeApplicationCallerGrant(grant); grants.delete(id) })
  void platform.registerHost({ sessionId, generation, ready, tools }).catch((error) => logger.error('连接应用宿主失败', error, { event: 'mcp.host.register.failed' }))
  return () => {
    disposed = true
    unsubscribeRequest(); unsubscribeCancel(); unsubscribeRevoke()
    for (const controller of active.values()) controller.abort()
    for (const grant of grants.values()) revokeApplicationCallerGrant(grant)
    void platform.registerHost({ sessionId, generation, ready: false, tools: [] }).catch((error) => logger.error('断开应用宿主失败', error, { event: 'mcp.host.disconnect.failed' }))
  }
}
