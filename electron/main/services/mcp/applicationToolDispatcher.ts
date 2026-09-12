import { z } from 'zod'
import { EXTERNAL_LIMITS, MCP_READ_CAPABILITY_IDS, MCP_WRITE_CAPABILITY_IDS } from '../../../../src/core/application-control/localHostContracts'
import { buildApplicationContract, buildMcpToolCatalog, describeContractInputSchema, invalidInputMessage, readMediaInputSchema, type McpAccess } from './toolCatalog'
import { readMcpMediaResource, McpMediaResourceError } from './mediaResources'
import type { ApplicationHostBridge } from './applicationHostBridge'
import type { McpOperationCoordinator } from './operationCoordinator'
const MAX_RESULT = EXTERNAL_LIMITS.resultBytes

/** 协议与内置 Agent 共用的受控执行入口；调用者身份仅由宿主提供。 */
export class ApplicationToolDispatcher {
  constructor(private readonly connections: { assertActive(id: string): void; access(id: string): McpAccess },
    private readonly host: ApplicationHostBridge, private readonly operations?: McpOperationCoordinator,
    private readonly port = 0, private readonly callerKind: 'external' | 'embedded' = 'external') {}
  catalog(callerId: string) {
    this.connections.assertActive(callerId)
    if (!this.host.ready) throw new Error('应用尚未就绪，请稍后重试。')
    return buildMcpToolCatalog({ tools: this.host.tools(), access: this.connections.access(callerId), operationsEnabled: Boolean(this.operations) })
  }
  async call(callerId: string, name: string, args: Record<string, unknown> | undefined, signal: AbortSignal) {
      this.connections.assertActive(callerId)
      if (name === 'describe_application_contract') {
        try {
          const { domains } = describeContractInputSchema.parse(args ?? {})
          const data = buildApplicationContract({ domains: this.host.domains(), access: this.connections.access(callerId), catalog: this.catalog(callerId), port: this.port, requestedDomains: domains, callerKind: this.callerKind })
          const result = { ok: true, data }
          // 与其余工具保持同一约定：成功显式给出 isError:false，调用方不必区分 undefined 与 false。
          return { isError: false, structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: invalidInputMessage(error) ?? (error instanceof Error ? error.message : '契约发现失败，请稍后重试。') }] }
        }
      }
      if (name === 'read_application_media') {
        try {
          const input = readMediaInputSchema.parse(args)
          const result = await readMcpMediaResource(input)
          this.connections.assertActive(callerId)
          return { isError: false, structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }
        } catch (error) {
          // 参数错误点名字段；业务失败仍然脱敏，不回传本地路径。
          const message = invalidInputMessage(error) ?? (error instanceof McpMediaResourceError ? `${error.code}:${error.message}` : '媒体读取失败，请稍后重试。')
          return { isError: true, content: [{ type: 'text', text: message }] }
        }
      }
      if (name === 'get_application_operation' && this.operations) {
        const parsed = z.object({ operationId: z.string().uuid() }).strict().safeParse(args)
        if (!parsed.success) return { isError: true, content: [{ type: 'text', text: invalidInputMessage(parsed.error)! }] }
        const operation = this.operations.store.get(parsed.data.operationId, callerId)
        const result = operation ? this.operations.result(operation) : { ok: false, executionState: 'not_found', message: '未找到已登记操作；这不是业务未执行的证明。' }
        return { isError: result.ok !== true, structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }
      }
      if ([...MCP_WRITE_CAPABILITY_IDS, 'retry_application_operation_save'].some((id) => id === name) && this.operations) {
        try {
          const access = this.connections.access(callerId)
          const operation = name === 'retry_application_operation_save'
            ? this.operations.prepareSaveRecovery(callerId, args ?? {}, this.host.sessionId, access)
            : this.operations.prepare(callerId, args ?? {}, this.host.sessionId, access, MCP_WRITE_CAPABILITY_IDS.find((id) => id === name))
          if (operation.state === 'prepared') {
            this.connections.assertActive(callerId)
            try { await this.host.execute(callerId, operation.capabilityId ?? 'change_application_entities', operation.input, signal, { operation, ...access }) } catch { /* 持久操作状态决定结果，等待失败不能覆盖事实。 */ }
          }
          this.connections.assertActive(callerId)
          const result = this.operations.result(this.operations.store.get(operation.operationId, callerId)!)
          return { isError: result.ok !== true, structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }
        } catch (error) { return { isError: true, content: [{ type: 'text', text: invalidInputMessage(error) ?? (error instanceof Error ? error.message : '写入未完成。') }] } }
      }
      const id = MCP_READ_CAPABILITY_IDS.find((value) => value === name)
      if (!id) return { isError: true, content: [{ type: 'text', text: '此连接只允许读取。请用 tools/list 查看可用工具。' }] }
      try {
        const sessionId = this.host.sessionId
        const raw = await this.host.execute(callerId, id, args ?? {}, signal, this.connections.access(callerId))
        const result = this.operations ? this.operations.rememberRead(callerId, raw, sessionId) : raw
        this.connections.assertActive(callerId)
        const text = JSON.stringify(result)
        if (Buffer.byteLength(text) > MAX_RESULT) throw new Error('读取结果过大，请缩小字段或分页读取。')
        return { isError: result.ok !== true, structuredContent: result, content: [{ type: 'text', text }] }
      } catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : '应用读取失败，请稍后重试。' }] } }
  }
}
