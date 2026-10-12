import { applicationFailure, type ApplicationResult } from '../../../../src/core/application-control/invocation'
import { z } from 'zod'
import { EXTERNAL_CONTRACT_VERSION, EXTERNAL_LIMITS, APPLICATION_READ_CAPABILITY_IDS, APPLICATION_WRITE_CAPABILITY_IDS } from '../../../../src/core/application-control/localHostContracts'
import { buildApplicationContract, buildApplicationToolCatalog, describeContractInputSchema, invalidInputMessage, operationReadInputSchema, readMediaInputSchema, type ApplicationAccess } from './toolCatalog'
import { readApplicationMediaResource, ApplicationMediaResourceError } from './mediaResources'
import type { ApplicationHostBridge } from './applicationHostBridge'
import { ApplicationHostNotReadyError } from './applicationHostBridge'
import type { ApplicationOperationCoordinator } from './operationCoordinator'
import { reserveGenerationBudget } from './generationBudget'
import { createMainLogger } from '../logging'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { isAssistantSkillError } from '../../../../src/core/assistant/skills'
import { agentSkillIndex, loadAgentSkill } from '../assistant/skills/agentSkills'
import { projectApplicationToolResult, type ResultDetailOptions } from './resultProjection'
import { validateApplicationToolOutput } from './outputContract'
const MAX_RESULT = EXTERNAL_LIMITS.resultBytes
const logger = createMainLogger('main.application_runtime')

/** 协议与内置 Agent 共用的受控执行入口；调用者身份仅由宿主提供。 */
export class ApplicationToolDispatcher {
  constructor(private readonly connections: { assertActive(id: string): void; access(id: string): ApplicationAccess },
    private readonly host: ApplicationHostBridge, private readonly operations?: ApplicationOperationCoordinator,
    private readonly port = 0, private readonly callerKind: 'external' | 'embedded' = 'external') {}
  catalog(callerId: string) {
    this.connections.assertActive(callerId)
    // 内置 Pi 的技能工具随 skills_index 层注入；外部连接在同一目录里得到唯一只读技能入口。
    return buildApplicationToolCatalog({ tools: this.host.tools(), access: this.connections.access(callerId), operationsEnabled: Boolean(this.operations), includeSkillTool: this.callerKind === 'external' })
  }
  /** Resources 与分块工具使用相同的领域授权和引用解析。 */
  async readMedia(callerId: string, args: Record<string, unknown> | undefined, signal: AbortSignal, metadataOnly = false): Promise<ApplicationResult> {
    this.connections.assertActive(callerId)
    try {
      const input = readMediaInputSchema.parse(args)
      const authorized = await this.host.execute(callerId, 'read_application_entity', { ref: input.ref, propertyIds: [] }, signal, this.connections.access(callerId))
      this.connections.assertActive(callerId)
      if (!authorized.ok) return { ...authorized, ok: false }
      if (signal.aborted) return applicationFailure('ABORTED:媒体读取已取消。')
      const media = await readApplicationMediaResource(input, metadataOnly)
      this.connections.assertActive(callerId)
      if (signal.aborted) return applicationFailure('ABORTED:媒体读取已取消。')
      return { ok: true, data: metadataOnly ? { ref: input.ref, mimeType: media.mimeType, totalBytes: media.totalBytes } : media }
    } catch (error) {
      const message = invalidInputMessage(error, readMediaInputSchema) ?? (error instanceof ApplicationMediaResourceError ? `${error.code}:${error.message}` : '媒体读取失败，请稍后重试。')
      return applicationFailure(message)
    }
  }
  async call(callerId: string, name: string, args: Record<string, unknown> | undefined, signal: AbortSignal): Promise<ApplicationResult> {
    this.connections.assertActive(callerId)
    const input = { ...args }
    const options: ResultDetailOptions = {}
    for (const key of ['includeRevisions', 'includeEvidence', 'includeDetails'] as const) {
      if (!(key in input)) continue
      const parsed = z.boolean().safeParse(input[key])
      if (!parsed.success) return applicationFailure(`INVALID_INPUT:${key} 必须是布尔值。`)
      options[key] = parsed.data
      delete input[key]
    }
    let raw = await this.callRaw(callerId, name, input, signal)
    if (name === 'get_current_application_context' && raw.ok && raw.data) {
      raw = { ...raw, data: { ...raw.data, externalContractVersion: EXTERNAL_CONTRACT_VERSION } }
    }
    const operation = name === 'get_application_operation' && typeof input.operationId === 'string'
      ? this.operations?.store.get(input.operationId, callerId) : undefined
    const result = projectApplicationToolResult(operation?.capabilityId ?? name, input, raw, options)
    validateApplicationToolOutput(name, this.catalog(callerId).tools.find(tool => tool.name === name)?.outputSchema, result)
    return result
  }
  private async callRaw(callerId: string, name: string, args: Record<string, unknown> | undefined, signal: AbortSignal): Promise<ApplicationResult> {
      this.connections.assertActive(callerId)
      if (name === 'describe_application_contract') {
        try {
          const { domains, detail } = describeContractInputSchema.parse(args ?? {})
          const skills = this.callerKind === 'external' ? await agentSkillIndex() : undefined
          this.connections.assertActive(callerId)
          const data = buildApplicationContract({ domains: this.host.domains(), access: this.connections.access(callerId), catalog: this.catalog(callerId), port: this.port, requestedDomains: domains, callerKind: this.callerKind, skills, detail })
          const result = { ok: true, data }
          return result
        } catch (error) {
          return applicationFailure(invalidInputMessage(error, describeContractInputSchema) ?? (error instanceof Error ? error.message : '契约发现失败，请稍后重试。'))
        }
      }
      if (name === 'read_application_media') {
        return this.readMedia(callerId, args, signal)
      }
      if (name === 'load_assistant_skill' && this.callerKind === 'external') {
        // 与内置 Pi 同一准入名单与注册表：停用、未准入、越界路径都在这里拒绝，不经渲染宿主。
        let result: ApplicationResult
        try { result = await loadAgentSkill(args ?? {}, signal, 'external') } catch (error) {
          if (signal.aborted) return applicationFailure('ABORTED:技能读取已取消。')
          result = applicationFailure(invalidInputMessage(error, BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)?.inputSchema) ?? (isAssistantSkillError(error) ? `${error.code}:${error.message}` : '技能读取失败，请稍后重试。'))
        }
        // 读取期间连接被撤销时不交付内容。
        this.connections.assertActive(callerId)
        return result
      }
      if ((name === 'get_application_operation' || name === 'review_application_operation') && this.operations) {
        const schema = name === 'get_application_operation' ? operationReadInputSchema : z.object({ operationId: z.string().uuid() }).strict()
        const parsed = schema.safeParse(args)
        if (!parsed.success) return applicationFailure(invalidInputMessage(parsed.error, schema)!)
        const operation = this.operations.store.get(parsed.data.operationId, callerId)
        if (operation) {
          try { await this.reconcileVerification(callerId, operation, signal) } catch { /* 核实不可用时保留原事实与屏障。 */ }
          if (name === 'review_application_operation') {
            if (!this.connections.access(callerId).allowWrites) return applicationFailure('PERMISSION_DENIED:此连接没有修改授权。')
            try {
              await this.operations.review(this.operations.store.get(operation.operationId, callerId)!, this.host.rendererEpoch, async ref => {
                const result = await this.host.execute(callerId, 'read_application_entity', { ref }, signal, { ...this.connections.access(callerId), reviewTarget: true })
                this.connections.assertActive(callerId)
                signal.throwIfAborted()
                return result
              }, () => { this.connections.assertActive(callerId); if (!this.connections.access(callerId).allowWrites) throw new Error('PERMISSION_DENIED:修改授权已撤销。') })
            } catch (error) { return applicationFailure(error instanceof Error ? error.message : '操作核对未完成。') }
          }
        }
        if (name === 'get_application_operation' && operation) {
          const page = operationReadInputSchema.parse(args)
          if (page.resultField) {
            const record = this.operations.store.get(operation.operationId, callerId)!
            const fields = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(record.capabilityId)?.pagedResultFields ?? []
            if (!fields.includes(page.resultField)) return applicationFailure('INVALID_INPUT:resultField 必须使用原结果 resultCollections 中的 field。')
            const values = (record.result?.data as Record<string, unknown> | undefined)?.[page.resultField]
            if (!Array.isArray(values)) return applicationFailure('NOT_FOUND:原操作还没有此结果，请查询原 operationId 的执行状态，禁止重放。')
            const start = Number(page.cursor ?? 0)
            if (!Number.isSafeInteger(start) || start > values.length) return applicationFailure('INVALID_INPUT:分页 cursor 无效。')
            const items: unknown[] = []
            let bytes = 0
            for (let index = start; index < values.length && items.length < page.limit; index++) {
              const itemBytes = Buffer.byteLength(JSON.stringify(values[index]))
              if (bytes + itemBytes > MAX_RESULT / 2) break
              items.push(values[index]); bytes += itemBytes
            }
            if (!items.length && start < values.length) return applicationFailure('RESULT_TOO_LARGE:单项结果超出传输预算，请读取目标实体核对；操作已执行，禁止重放。')
            return { ok: true, data: { resultRef: { operationId: record.operationId, field: page.resultField }, total: values.length, items,
              nextCursor: start + items.length < values.length ? String(start + items.length) : null } }
          }
        }
        const result = operation ? this.operations.result(this.operations.store.get(operation.operationId, callerId)!) : { ok: false, executionState: 'not_found', message: '未找到已登记操作；这不是业务未执行的证明。' }
        return { ...result, ok: result.ok === true }
      }
      if ([...APPLICATION_WRITE_CAPABILITY_IDS, 'retry_application_operation_save'].some((id) => id === name) && this.operations) {
        try {
          const access = this.connections.access(callerId)
          const writeId = APPLICATION_WRITE_CAPABILITY_IDS.find(id => id === name)
          if (!this.host.ready && access.allowWrites && writeId) {
            const result = this.operations.result(this.operations.rejectBeforeDispatch(callerId, args ?? {}, writeId, 1000))
            return { ...result, ok: result.ok === true }
          }
          if (name === 'change_application_entities' && access.allowWrites && Array.isArray(args?.changes)) {
            const targets = args.changes.map(change => change && typeof change === 'object' ? (change as { target?: unknown }).target : undefined)
            for (const unresolved of this.operations.store.unresolved()) {
              if (unresolved.state !== 'partial' || !unresolved.targetRefs?.some(ref => targets.some(target => {
                const value = target as { kind?: string; id?: string } | undefined
                return value?.kind === ref.kind && value.id === ref.id
              }))) continue
              // 可由当前获授权的调用者回读核对，绝不披露另一调用者的账本或执行其原修改。
              try { await this.reconcileVerification(callerId, unresolved, signal) } catch { /* 继续让原屏障准确拒绝。 */ }
            }
          }
          const operation = name === 'retry_application_operation_save'
            ? this.operations.prepareSaveRecovery(callerId, args ?? {}, this.host.rendererEpoch, access)
            : this.operations.prepare(callerId, args ?? {}, this.host.rendererEpoch, access, APPLICATION_WRITE_CAPABILITY_IDS.find((id) => id === name), this.callerKind)
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
                logger.info('生成参数与费用检查通过', { event: 'application.generation_preflight.completed', requestId: operation.operationId, context: { estimatedCny: this.operations.store.get(operation.operationId, callerId)?.paidGenerationEstimate } })
              } catch (error) {
                const message = error instanceof Error ? error.message : '生成准备失败。'
                const code = /^(PROVIDER_(?:PRODUCT_NOT_ACTIVATED|MODEL_ACCESS_DENIED|INSUFFICIENT_BALANCE)):/.exec(message)?.[1] ?? 'GENERATION_PREFLIGHT_REJECTED'
                logger.warn('生成提交前检查未通过', { event: 'application.generation_preflight.failed', requestId: operation.operationId, error })
                if (this.operations.store.get(operation.operationId, callerId)?.state === 'preparing') this.operations.store.save({ ...this.operations.store.get(operation.operationId, callerId)!, state: 'not_executed', verificationState: 'verified', result: { ok: false, error: { code, message, details: { execution: { notExecuted: true } } } } })
              }
            }
            if (this.operations.store.get(operation.operationId, callerId)?.state === 'preparing') {
              try { await this.host.execute(callerId, operation.capabilityId, operation.input, signal, { operation, ...access }) } catch (error) {
                const current = this.operations.store.get(operation.operationId, callerId)!
                // 尚未派发的宿主拒绝是明确零执行；已派发后的等待失败保留执行事实。
                if (current.state === 'preparing') this.operations.store.save({ ...current, state: 'not_executed', result: {
                  ok: false, error: { code: 'DISPATCH_REJECTED', message: error instanceof Error ? error.message : '应用尚未就绪。', recoverable: true, details: { execution: { notExecuted: true }, ...(error instanceof ApplicationHostNotReadyError ? { retryAfterMs: error.retryAfterMs } : {}) } },
                } })
              }
            }
          }
          this.connections.assertActive(callerId)
          const result = this.operations.result(this.operations.store.get(operation.operationId, callerId)!)
          return { ...result, ok: result.ok === true }
        } catch (error) { return applicationFailure(invalidInputMessage(error, BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)?.inputSchema) ?? (error instanceof Error ? error.message : '写入未完成。')) }
      }
      const id = APPLICATION_READ_CAPABILITY_IDS.find((value) => value === name)
      if (!id) return applicationFailure('此连接只允许读取。请用 tools/list 查看可用工具。')
      try {
        const raw = await this.host.execute(callerId, id, args ?? {}, signal, this.connections.access(callerId))
        const result = this.operations ? this.operations.rememberRead(callerId, raw, typeof raw.revisionEpoch === 'string' ? raw.revisionEpoch : this.host.rendererEpoch) : raw
        this.connections.assertActive(callerId)
        const text = JSON.stringify(result)
        if (Buffer.byteLength(text) > MAX_RESULT) throw new Error('读取结果过大，请缩小字段或分页读取。')
        return { ...result, ok: result.ok === true }
      } catch (error) {
        if (error instanceof ApplicationHostNotReadyError) return { ok: false, error: { code: 'APPLICATION_NOT_READY', message: error.message, recoverable: true, details: { retryAfterMs: error.retryAfterMs, execution: { notExecuted: true } } } }
        return applicationFailure(invalidInputMessage(error, BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)?.inputSchema) ?? (error instanceof Error ? error.message : '应用读取失败，请稍后重试。'))
      }
  }
  async reconcileVerification(callerId: string, record: import('./operationStore').OperationRecord, signal: AbortSignal): Promise<void> {
    await this.operations?.reconcileReceipt(record, async original => {
      const result = await this.host.execute(callerId, 'get_current_application_context', {}, signal,
        { ...this.connections.access(callerId), recoveryOperation: original })
      this.connections.assertActive(callerId)
      if (signal.aborted) throw new Error('核实已取消。')
      return result
    })
    record = this.operations?.store.get(record.operationId, record.callerId) ?? record
    await this.operations?.reconcileVerification(record, async proof => {
      const result = await this.host.execute(callerId, 'get_current_application_context', {}, signal,
        { ...this.connections.access(callerId), recoveryVerification: proof })
      this.connections.assertActive(callerId)
      if (signal.aborted) throw new Error('核实已取消。')
      logger.info('原事务最终状态已重新核对', { event: 'application.operation.verification_rechecked', context: { verified: (result.data as { verification?: { verified?: boolean } } | undefined)?.verification?.verified === true } })
      return result
    })
  }
}
