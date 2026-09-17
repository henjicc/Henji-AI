import { applicationFailure, type ApplicationResult } from '../../../../src/core/application-control/invocation'
import { z } from 'zod'
import { EXTERNAL_LIMITS, APPLICATION_READ_CAPABILITY_IDS, APPLICATION_WRITE_CAPABILITY_IDS } from '../../../../src/core/application-control/localHostContracts'
import { buildApplicationContract, buildApplicationToolCatalog, describeContractInputSchema, invalidInputMessage, readMediaInputSchema, type ApplicationAccess } from './toolCatalog'
import { readApplicationMediaResource, ApplicationMediaResourceError } from './mediaResources'
import type { ApplicationHostBridge } from './applicationHostBridge'
import type { ApplicationOperationCoordinator } from './operationCoordinator'
import { reserveGenerationBudget } from './generationBudget'
import { createMainLogger } from '../logging'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
const MAX_RESULT = EXTERNAL_LIMITS.resultBytes
const logger = createMainLogger('main.application_runtime')

/** 协议与内置 Agent 共用的受控执行入口；调用者身份仅由宿主提供。 */
export class ApplicationToolDispatcher {
  constructor(private readonly connections: { assertActive(id: string): void; access(id: string): ApplicationAccess },
    private readonly host: ApplicationHostBridge, private readonly operations?: ApplicationOperationCoordinator,
    private readonly port = 0, private readonly callerKind: 'external' | 'embedded' = 'external') {}
  catalog(callerId: string) {
    this.connections.assertActive(callerId)
    return buildApplicationToolCatalog({ tools: this.host.tools(), access: this.connections.access(callerId), operationsEnabled: Boolean(this.operations) })
  }
  /** Resources 与分块工具使用相同的领域授权和引用解析。 */
  async readMedia(callerId: string, args: Record<string, unknown> | undefined, signal: AbortSignal, metadataOnly = false): Promise<ApplicationResult> {
    this.connections.assertActive(callerId)
    try {
      const input = readMediaInputSchema.parse(args)
      const authorized = await this.call(callerId, 'read_application_entity', { ref: input.ref }, signal)
      if (!authorized.ok) return authorized
      if (signal.aborted) return applicationFailure('ABORTED:媒体读取已取消。')
      const media = await readApplicationMediaResource(input, metadataOnly)
      this.connections.assertActive(callerId)
      if (signal.aborted) return applicationFailure('ABORTED:媒体读取已取消。')
      return { ok: true, data: metadataOnly ? { ref: input.ref, mimeType: media.mimeType, totalBytes: media.totalBytes } : media }
    } catch (error) {
      const message = invalidInputMessage(error) ?? (error instanceof ApplicationMediaResourceError ? `${error.code}:${error.message}` : '媒体读取失败，请稍后重试。')
      return applicationFailure(message)
    }
  }
  async call(callerId: string, name: string, args: Record<string, unknown> | undefined, signal: AbortSignal): Promise<ApplicationResult> {
      this.connections.assertActive(callerId)
      if (name === 'describe_application_contract') {
        try {
          const { domains } = describeContractInputSchema.parse(args ?? {})
          const data = buildApplicationContract({ domains: this.host.domains(), access: this.connections.access(callerId), catalog: this.catalog(callerId), port: this.port, requestedDomains: domains, callerKind: this.callerKind })
          const result = { ok: true, data }
          return result
        } catch (error) {
          return applicationFailure(invalidInputMessage(error) ?? (error instanceof Error ? error.message : '契约发现失败，请稍后重试。'))
        }
      }
      if (name === 'read_application_media') {
        return this.readMedia(callerId, args, signal)
      }
      if (name === 'get_application_operation' && this.operations) {
        const parsed = z.object({ operationId: z.string().uuid() }).strict().safeParse(args)
        if (!parsed.success) return applicationFailure(invalidInputMessage(parsed.error)!)
        const operation = this.operations.store.get(parsed.data.operationId, callerId)
        const result = operation ? this.operations.result(operation) : { ok: false, executionState: 'not_found', message: '未找到已登记操作；这不是业务未执行的证明。' }
        return { ...result, ok: result.ok === true }
      }
      if ([...APPLICATION_WRITE_CAPABILITY_IDS, 'retry_application_operation_save'].some((id) => id === name) && this.operations) {
        try {
          const access = this.connections.access(callerId)
          const operation = name === 'retry_application_operation_save'
            ? this.operations.prepareSaveRecovery(callerId, args ?? {}, this.host.rendererEpoch, access)
            : this.operations.prepare(callerId, args ?? {}, this.host.rendererEpoch, access, APPLICATION_WRITE_CAPABILITY_IDS.find((id) => id === name))
          if (operation.state === 'prepared' && this.operations.store.beginPreparation(operation)) {
            this.connections.assertActive(callerId)
            const preparationId = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(operation.capabilityId)?.paidGenerationPreparation
            if (preparationId) {
              try {
                const preparationCapability = APPLICATION_READ_CAPABILITY_IDS.find(id => id === preparationId)
                if (!preparationCapability) throw new Error('付费生成的准备入口尚未向当前连接开放。')
                logger.info('检查生成参数与费用', { event: 'application.generation_preflight.start', requestId: operation.operationId })
                const preparation = await this.host.execute(callerId, preparationCapability, operation.input, signal, access)
                this.connections.assertActive(callerId)
                if (signal.aborted) throw new Error('操作已取消。')
                reserveGenerationBudget(this.operations.store, operation, preparation)
                logger.info('生成参数与费用检查通过', { event: 'application.generation_preflight.completed', requestId: operation.operationId, context: { estimatedCny: this.operations.store.get(operation.operationId, callerId)?.generationEstimate?.cny } })
              } catch (error) {
                const message = error instanceof Error ? error.message : '生成准备失败。'
                logger.warn('生成提交前检查未通过', { event: 'application.generation_preflight.failed', requestId: operation.operationId, error })
                if (this.operations.store.get(operation.operationId, callerId)?.state === 'preparing') this.operations.store.save({ ...this.operations.store.get(operation.operationId, callerId)!, state: 'not_executed', result: { ok: false, error: { code: 'GENERATION_PREFLIGHT_REJECTED', message, details: { execution: { notExecuted: true } } } } })
              }
            }
            if (this.operations.store.get(operation.operationId, callerId)?.state === 'preparing') {
              try { await this.host.execute(callerId, operation.capabilityId, operation.input, signal, { operation, ...access }) } catch (error) {
                const current = this.operations.store.get(operation.operationId, callerId)!
                // 尚未派发的宿主拒绝是明确零执行；已派发后的等待失败保留执行事实。
                if (current.state === 'preparing') this.operations.store.save({ ...current, state: 'not_executed', result: {
                  ok: false, error: { code: 'DISPATCH_REJECTED', message: error instanceof Error ? error.message : '应用尚未就绪。', details: { execution: { notExecuted: true } } },
                } })
              }
            }
          }
          this.connections.assertActive(callerId)
          const result = this.operations.result(this.operations.store.get(operation.operationId, callerId)!)
          return { ...result, ok: result.ok === true }
        } catch (error) { return applicationFailure(invalidInputMessage(error) ?? (error instanceof Error ? error.message : '写入未完成。')) }
      }
      const id = APPLICATION_READ_CAPABILITY_IDS.find((value) => value === name)
      if (!id) return applicationFailure('此连接只允许读取。请用 tools/list 查看可用工具。')
      try {
        const rendererEpoch = this.host.rendererEpoch
        const raw = await this.host.execute(callerId, id, args ?? {}, signal, this.connections.access(callerId))
        const result = this.operations ? this.operations.rememberRead(callerId, raw, rendererEpoch) : raw
        this.connections.assertActive(callerId)
        const text = JSON.stringify(result)
        if (Buffer.byteLength(text) > MAX_RESULT) throw new Error('读取结果过大，请缩小字段或分页读取。')
        return { ...result, ok: result.ok === true }
      } catch (error) { return applicationFailure(error instanceof Error ? error.message : '应用读取失败，请稍后重试。') }
  }
}
