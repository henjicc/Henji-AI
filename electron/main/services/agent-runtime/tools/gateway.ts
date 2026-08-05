import { createMainLogger } from '../../logging'
import type { AgentPermissionAuditFact } from '../../../../../src/core/assistant/permissionAudit'
import {
  agentToolGatewayResultSchema,
  agentToolObservationSchema,
  agentToolPreviewSchema,
  type AgentToolGatewayResult,
} from '../../../../../src/core/assistant/toolContracts'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { AgentApprovalError, AgentApprovalManager, assertApprovalPreviewTargets } from './approval'
import { AgentApprovalCoordinator } from './approval-coordinator'
import { decideToolAuthorization } from './approval-policy'
import { AgentIdempotencyLedger } from './idempotency'
import { buildPermissionAuditTemplate } from './permission-audit'
import { AgentToolRegistry } from './registry'
import {
  TOOL_INPUT_LIMITS,
  TOOL_OUTPUT_LIMITS,
  TOOL_PREVIEW_LIMITS,
  assertJsonWithinLimits,
  digestJson,
  summarizeSafeText,
} from './security'
import type { AgentToolExecuteRequest } from './types'
import type { AgentToolDefinition } from './types'
import {
  AgentToolGatewayError,
  assertOutputDataClassesCovered,
  assertPreviewDataBoundary,
  createDefaultPreview,
  createLinkedController,
  currentRevisions,
  executeToolWithRetry,
  requiredContextForInput,
  throwIfAborted,
  toGatewayError,
  validateAuthorizationSource,
  validateContext,
} from './gateway-support'

export { AgentToolGatewayError } from './gateway-support'

const logger = createMainLogger('main.agent_tool')

export interface AgentToolGatewayOptions {
  registry: AgentToolRegistry
  getHostContext: (runId: string) => HostContextSnapshot | null
  approvals?: AgentApprovalManager
  idempotency?: AgentIdempotencyLedger
  appendPermissionAudit: (fact: AgentPermissionAuditFact) => Promise<void>
}

function inputWithAuthoritativeRevision(
  definition: AgentToolDefinition,
  rawInput: unknown,
  expectedRevisions: AgentToolExecuteRequest['expectedRevisions']
): unknown {
  if (!definition.capability || !rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    return rawInput
  }
  const input = rawInput as Record<string, unknown>
  const authoritative = expectedRevisions?.toolbox
  const candidateRevision = authoritative ?? 0
  const candidate = definition.inputSchema.safeParse({
    ...input,
    baseRevision: candidateRevision,
  })
  const acceptsLegacyBaseRevision = candidate.success
    && candidate.data !== null
    && typeof candidate.data === 'object'
    && !Array.isArray(candidate.data)
    && Object.hasOwn(candidate.data, 'baseRevision')
  if (!acceptsLegacyBaseRevision) return rawInput
  if (authoritative === undefined) {
    throw new AgentToolGatewayError('STALE_CONTEXT', '缺少 Gateway expected revision 信封中的 toolbox revision')
  }
  if (input.baseRevision !== undefined && input.baseRevision !== authoritative) {
    throw new AgentToolGatewayError('CONFLICT', '兼容 baseRevision 与 Gateway expected revision 不一致')
  }
  return candidate.data
}

export class AgentToolGateway {
  private readonly ledger: AgentIdempotencyLedger
  private readonly approvalCoordinator: AgentApprovalCoordinator
  private readonly locks = new Set<string>()
  private readonly executionCounts = new Map<string, number>()

  constructor(private readonly options: AgentToolGatewayOptions) {
    this.ledger = options.idempotency ?? new AgentIdempotencyLedger()
    this.approvalCoordinator = new AgentApprovalCoordinator(
      options.appendPermissionAudit,
      options.approvals
    )
  }

  async resolveApproval(
    approvalId: string,
    runId: string,
    decision: 'approve' | 'reject'
  ): Promise<'approved' | 'rejected'> {
    return this.approvalCoordinator.resolve(approvalId, runId, decision)
  }

  async expireApproval(approvalId: string, runId: string): Promise<'expired'> {
    return this.approvalCoordinator.expire(approvalId, runId)
  }

  async expireRunApprovals(runId: string): Promise<void> {
    await this.approvalCoordinator.expireRun(runId)
  }

  async execute(request: AgentToolExecuteRequest): Promise<AgentToolGatewayResult> {
    const startedAt = Date.now()
    const definition = this.options.registry.get(request.toolName)
    if (!definition) throw new AgentToolGatewayError('UNKNOWN_TOOL', `未注册工具：${request.toolName}`)
    if (definition.risk === 'R4') throw new AgentToolGatewayError('PERMISSION_DENIED', 'R4 工具禁止执行')

    try {
      throwIfAborted(request.signal)
      const context = this.options.getHostContext(request.runId)
      const normalizedInput = inputWithAuthoritativeRevision(
        definition,
        request.input,
        request.expectedRevisions
      )
      assertJsonWithinLimits(normalizedInput, TOOL_INPUT_LIMITS)
      const initialInput = definition.inputSchema.parse(normalizedInput)
      const executionContext = {
        runId: request.runId,
        threadId: request.threadId,
        toolCallId: request.toolCallId,
        signal: request.signal,
        hostContext: context,
      }
      const rawPreview = definition.preview
        ? await definition.preview(initialInput, executionContext)
        : createDefaultPreview(definition, initialInput)
      throwIfAborted(request.signal)
      assertJsonWithinLimits(rawPreview, TOOL_PREVIEW_LIMITS)
      const preview = agentToolPreviewSchema.parse(rawPreview)
      assertPreviewDataBoundary(preview)
      assertJsonWithinLimits(initialInput, TOOL_INPUT_LIMITS)
      const input = definition.inputSchema.parse(initialInput)
      const requiredContext = requiredContextForInput(definition, input)
      assertApprovalPreviewTargets(definition, input, preview)
      validateAuthorizationSource(request)
      const expectedRevisions = currentRevisions(context, requiredContext)
      const ledgerKey = `${request.runId}:${request.toolCallId}:${definition.version}`
      const inputDigest = digestJson(input)
      const authorization = decideToolAuthorization({
        mode: request.approvalMode,
        risk: definition.risk,
        readOnly: definition.readOnly,
        destructive: definition.destructive,
        dataClasses: preview.dataClasses,
        explicitUserIntent: request.explicitUserIntent,
      })
      const auditTemplate = buildPermissionAuditTemplate({
        runId: request.runId,
        toolCallId: request.toolCallId,
        approvalMode: request.approvalMode,
        authorizationSource: request.authorizationSource ?? 'direct',
        parentToolCallId: request.parentToolCallId,
        definition,
        input,
        preview,
        expectedRevisions,
      })
      const authorizationDigest = digestJson(auditTemplate)
      const consumeInput = request.approvalId
        ? {
          approvalId: request.approvalId,
          runId: request.runId,
          toolCallId: request.toolCallId,
          definition,
          input,
          preview,
          expectedRevisions,
        }
        : null
      const existing = this.ledger.lookup(ledgerKey, inputDigest)

      if (consumeInput && (!existing || preview.dataClasses.includes('C2'))) {
        await this.approvalCoordinator.assertConsumable(auditTemplate, consumeInput)
      }
      if (authorization === 'denied') {
        await this.approvalCoordinator.recordDenied(auditTemplate, request.approvalId)
        throw new AgentToolGatewayError('PERMISSION_DENIED', '工具请求触及禁止的数据或风险边界')
      }
      validateContext(requiredContext, context, request.expectedRevisions)

      if (existing?.status === 'cached' && !preview.dataClasses.includes('C2')) {
        if (existing.authorizationDigest !== authorizationDigest) {
          if (request.approvalId) {
            await this.approvalCoordinator.record({
              template: auditTemplate,
              approvalId: request.approvalId,
              event: 'binding_failed',
              reasonCode: 'CACHED_AUTHORIZATION_MISMATCH',
            })
            throw new AgentApprovalError('APPROVAL_INVALID', '缓存结果的审批绑定与当前调用不一致')
          }
          throw new AgentToolGatewayError('CONFLICT', '缓存结果的授权摘要与当前调用不一致')
        }
        await this.approvalCoordinator.record({
          template: auditTemplate,
          event: 'execution_cached',
          reasonCode: 'IDEMPOTENT_CACHE_HIT',
          result: { dataClasses: existing.observation.dataClasses },
        })
        return agentToolGatewayResultSchema.parse({
          status: 'completed',
          observation: existing.observation,
          cached: true,
        })
      }

      if (authorization === 'approval_required') {
        if (!request.approvalId) {
          const approval = await this.approvalCoordinator.request(auditTemplate, {
            runId: request.runId,
            toolCallId: request.toolCallId,
            definition,
            input,
            preview,
            expectedRevisions,
          })
          return agentToolGatewayResultSchema.parse({ status: 'approval_required', approval })
        }
      }

      if (consumeInput) {
        await this.approvalCoordinator.consume(auditTemplate, consumeInput)
      } else if (authorization === 'auto_allowed') {
        await this.approvalCoordinator.record({
          template: auditTemplate,
          event: 'auto_allowed',
          reasonCode: request.authorizationSource === 'approved_workflow'
            ? 'APPROVED_WORKFLOW_DELEGATION'
            : 'POLICY_AUTO_ALLOWED',
        })
      }
      throwIfAborted(request.signal)
      const latestContext = this.options.getHostContext(request.runId)
      validateContext(requiredContext, latestContext, expectedRevisions)

      if (existing?.status === 'cached') {
        if (existing.authorizationDigest !== authorizationDigest) {
          throw new AgentApprovalError('APPROVAL_INVALID', '缓存结果的授权摘要与当前审批不一致')
        }
        await this.approvalCoordinator.record({
          template: auditTemplate,
          approvalId: request.approvalId,
          event: 'execution_cached',
          reasonCode: 'SENSITIVE_CACHE_HIT',
          result: { dataClasses: existing.observation.dataClasses },
        })
        return agentToolGatewayResultSchema.parse({
          status: 'completed',
          observation: existing.observation,
          cached: true,
        })
      }

      assertJsonWithinLimits(input, TOOL_INPUT_LIMITS)
      const executableInput = definition.inputSchema.parse(input)
      if (digestJson(executableInput) !== inputDigest) {
        throw new AgentToolGatewayError('INVALID_INPUT', '工具最终参数在校验过程中发生变化')
      }
      assertApprovalPreviewTargets(definition, executableInput, preview)
      throwIfAborted(request.signal)

      const executionCountKey = `${request.runId}:${definition.name}`
      const executionCount = this.executionCounts.get(executionCountKey) ?? 0
      if (
        definition.maxCallsPerRun !== undefined
        && executionCount >= definition.maxCallsPerRun
      ) {
        throw new AgentToolGatewayError(
          'CONFLICT',
          `${definition.title} 在本次任务中已达到调用上限，请使用已有结果继续`
        )
      }

      const begun = this.ledger.begin(ledgerKey, inputDigest, authorizationDigest)
      if (begun.status === 'cached') {
        if (begun.authorizationDigest !== authorizationDigest) {
          throw new AgentToolGatewayError('CONFLICT', '并发缓存结果的授权摘要不一致')
        }
        await this.approvalCoordinator.record({
          template: auditTemplate,
          approvalId: request.approvalId,
          event: 'execution_cached',
          reasonCode: 'CONCURRENT_CACHE_HIT',
          result: { dataClasses: begun.observation.dataClasses },
        })
        return agentToolGatewayResultSchema.parse({
          status: 'completed',
          observation: begun.observation,
          cached: true,
        })
      }

      const concurrencyKey = definition.concurrencyKey(executableInput)
      if (this.locks.has(concurrencyKey)) {
        this.ledger.fail(ledgerKey)
        throw new AgentToolGatewayError('CONFLICT', `工具并发键冲突：${concurrencyKey}`, true, 'wait')
      }
      this.locks.add(concurrencyKey)
      if (definition.maxCallsPerRun !== undefined) {
        this.executionCounts.set(executionCountKey, executionCount + 1)
      }
      logger.info('Agent 工具执行开始', {
        event: 'agent_tool.execute.started',
        requestId: request.runId,
        taskId: request.toolCallId,
        context: { toolName: definition.name, version: definition.version, risk: definition.risk },
      })

      const linked = createLinkedController(request.signal, definition.timeoutMs)
      let executionCommitted = false
      try {
        const output = await executeToolWithRetry(
          definition,
          executableInput,
          { ...executionContext, signal: linked.controller.signal, hostContext: latestContext }
        )
        throwIfAborted(linked.controller.signal)
        assertJsonWithinLimits(output, TOOL_OUTPUT_LIMITS)
        const parsedOutput = definition.outputSchema.parse(output)
        const dataClasses = definition.dataClasses(parsedOutput)
        if (dataClasses.includes('C3')) {
          throw new AgentToolGatewayError('PERMISSION_DENIED', '工具结果包含 C3 秘密数据，禁止进入 Agent 上下文')
        }
        assertOutputDataClassesCovered(preview, dataClasses)
        const observation = agentToolObservationSchema.parse({
          source: { toolName: definition.name, toolVersion: definition.version, toolCallId: request.toolCallId },
          trust: 'untrusted_observation',
          dataClasses,
          summary: summarizeSafeText(definition.summarize(parsedOutput)),
          output: parsedOutput,
          undo: definition.undo?.(parsedOutput),
        })
        this.ledger.succeed(ledgerKey, observation)
        executionCommitted = true
        await this.approvalCoordinator.record({
          template: auditTemplate,
          approvalId: request.approvalId,
          event: 'execution_completed',
          reasonCode: 'TOOL_EXECUTION_SUCCEEDED',
          result: {
            durationMs: Date.now() - startedAt,
            dataClasses,
          },
        })
        logger.info('Agent 工具执行完成', {
          event: 'agent_tool.execute.completed',
          requestId: request.runId,
          taskId: request.toolCallId,
          context: { toolName: definition.name, durationMs: Date.now() - startedAt, cached: false },
        })
        return agentToolGatewayResultSchema.parse({ status: 'completed', observation, cached: false })
      } catch (error) {
        if (!executionCommitted && definition.maxCallsPerRun !== undefined) {
          this.executionCounts.set(executionCountKey, executionCount)
        }
        if (!executionCommitted) {
          if (!definition.readOnly && linked.controller.signal.aborted) this.ledger.markUnknown(ledgerKey)
          else this.ledger.fail(ledgerKey)
          const executionError = toGatewayError(error)
          await this.approvalCoordinator.record({
            template: auditTemplate,
            approvalId: request.approvalId,
            event: 'execution_failed',
            reasonCode: 'TOOL_EXECUTION_FAILED',
            result: {
              errorCode: executionError.code,
              durationMs: Date.now() - startedAt,
            },
          })
        }
        throw error
      } finally {
        linked.dispose()
        this.locks.delete(concurrencyKey)
      }
    } catch (error) {
      const gatewayError = this.withCapabilityHint(toGatewayError(error))
      logger.error('Agent 工具执行失败', {
        event: 'agent_tool.execute.failed',
        requestId: request.runId,
        taskId: request.toolCallId,
        context: { toolName: request.toolName, durationMs: Date.now() - startedAt, errorCode: gatewayError.code },
      })
      throw gatewayError
    }
  }

  /**
   * 「这个集合不能用通用动词增删」必须同时告诉模型该用哪个专用能力。
   *
   * 按项目规则，带算法语义的创建（三维对象的碰撞检测与复用判定就是典型）只留在专用能力里，
   * 通用动词有意不开放。但引擎只会抛一句 COLLECTION_WRITE_NOT_DECLARED:<实体类型>，模型无从
   * 得知替代路径——实测它在这里直接放弃，整张任务图剩四个 Facet 未结算。
   * 能力注册表就在手边，把候选算出来附上即可，对所有实体类型通用。
   */
  private withCapabilityHint(error: AgentToolGatewayError): AgentToolGatewayError {
    const entityType = /^COLLECTION_(?:WRITE_NOT_DECLARED|CREATE_NOT_ALLOWED|REMOVE_NOT_ALLOWED):(\S+)/
      .exec(error.message)?.[1]
    if (!entityType) return error
    const candidates = this.options.registry.allDefinitions().flatMap((definition) => (
      definition.readOnly === false
      && (definition.capability?.control?.impacts ?? []).some((impact) => (
        impact.entityTypes.includes(entityType)
        && ['create', 'execute', 'delete'].includes(impact.effect)
      ))
        ? [definition.name]
        : []
    )).slice(0, 6)
    if (candidates.length === 0) return error
    return new AgentToolGatewayError(
      error.code,
      `${error.message}。${entityType} 的增删由专用能力负责，请改用：${candidates.join('、')}`,
      error.retryable,
      error.recovery
    )
  }
}
