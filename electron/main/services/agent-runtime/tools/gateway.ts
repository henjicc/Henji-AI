import { z } from 'zod'

import { createMainLogger } from '../../logging'
import {
  agentToolGatewayResultSchema,
  agentToolObservationSchema,
  type AgentToolErrorCode,
  type AgentToolGatewayResult,
  type AgentToolPreview,
} from '../../../../../src/core/assistant/toolContracts'
import type { HostContextSnapshot, HostScope, HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import { AgentApprovalError, AgentApprovalManager } from './approval'
import { AgentIdempotencyConflictError, AgentIdempotencyLedger } from './idempotency'
import { AgentToolRegistry } from './registry'
import {
  TOOL_INPUT_LIMITS,
  TOOL_OUTPUT_LIMITS,
  assertJsonWithinLimits,
  digestJson,
  summarizeSafeText,
} from './security'
import type { AgentToolDefinition, AgentToolExecuteRequest } from './types'

const logger = createMainLogger('main.agent_tool')

export class AgentToolGatewayError extends Error {
  constructor(
    readonly code: AgentToolErrorCode,
    message: string,
    readonly retryable = false,
    readonly recovery: 'refresh_context' | 'request_approval' | 'wait' | 'user_action' | 'none' = 'none'
  ) {
    super(message)
    this.name = 'AgentToolGatewayError'
  }
}

export interface AgentToolGatewayOptions {
  registry: AgentToolRegistry
  getHostContext: (runId: string) => HostContextSnapshot | null
  approvals?: AgentApprovalManager
  idempotency?: AgentIdempotencyLedger
}

function toGatewayError(error: unknown): AgentToolGatewayError {
  if (error instanceof AgentToolGatewayError) return error
  if (error instanceof AgentApprovalError) {
    return new AgentToolGatewayError(error.code, error.message, false, 'request_approval')
  }
  if (error instanceof AgentIdempotencyConflictError) {
    return new AgentToolGatewayError('CONFLICT', error.message, false, 'user_action')
  }
  if (error instanceof z.ZodError) {
    return new AgentToolGatewayError('INVALID_INPUT', '工具参数或结果未通过 schema 校验')
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'TIMEOUT') return new AgentToolGatewayError('TIMEOUT', '工具执行超时', true, 'wait')
  if (message === 'CANCELLED') return new AgentToolGatewayError('CANCELLED', '工具调用已取消')
  const hostErrorCode = /^\[([A-Z_]+)\]/.exec(message)?.[1]
  if (hostErrorCode === 'STALE_CONTEXT') {
    return new AgentToolGatewayError('STALE_CONTEXT', message, true, 'refresh_context')
  }
  if (hostErrorCode === 'ABORTED') return new AgentToolGatewayError('CANCELLED', message)
  if (hostErrorCode === 'DEADLINE_EXCEEDED') {
    return new AgentToolGatewayError('TIMEOUT', message, true, 'wait')
  }
  if (hostErrorCode === 'NOT_FOUND') {
    return new AgentToolGatewayError('NOT_FOUND', message, false, 'user_action')
  }
  return new AgentToolGatewayError('EXECUTION_FAILED', message || '工具执行失败')
}

function currentRevisions(context: HostContextSnapshot | null, scopes: HostScope[]): Record<string, number> {
  if (!context) return {}
  return Object.fromEntries(scopes.map((scope) => [scope, context.scopeRevisions[scope]]))
}

function validateContext(
  definition: AgentToolDefinition,
  context: HostContextSnapshot | null,
  expected: Partial<HostScopeRevisions> | undefined
): void {
  if (definition.requiredContext.length > 0 && (!context || !context.uiReady)) {
    throw new AgentToolGatewayError('NOT_READY', '宿主界面尚未就绪', true, 'wait')
  }
  if (!context || !expected) return
  for (const scope of definition.requiredContext) {
    const expectedValue = expected[scope]
    if (expectedValue !== undefined && context.scopeRevisions[scope] !== expectedValue) {
      throw new AgentToolGatewayError('STALE_CONTEXT', `宿主 ${scope} 上下文已变化`, true, 'refresh_context')
    }
  }
}

function requiresApproval(definition: AgentToolDefinition, explicitUserIntent: boolean): boolean {
  if (definition.risk === 'R2' || definition.risk === 'R3') return true
  return definition.risk === 'R1' && !explicitUserIntent
}

function createDefaultPreview(definition: AgentToolDefinition, input: unknown): AgentToolPreview {
  return {
    title: definition.title,
    summary: `${definition.title} 将作用于 ${Object.keys(definition.targetIds(input)).length || 1} 个明确目标。`,
    targetIds: definition.targetIds(input),
    reversible: definition.supportsUndo,
    dataClasses: definition.openWorld ? ['C1'] : ['C0'],
  }
}

function createLinkedController(parent: AbortSignal, timeoutMs: number): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort('CANCELLED')
  parent.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort('TIMEOUT'), timeoutMs)
  return {
    controller,
    dispose: () => {
      clearTimeout(timeout)
      parent.removeEventListener('abort', onAbort)
    },
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw new Error(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED')
}

export class AgentToolGateway {
  readonly approvals: AgentApprovalManager
  private readonly ledger: AgentIdempotencyLedger
  private readonly locks = new Set<string>()

  constructor(private readonly options: AgentToolGatewayOptions) {
    this.approvals = options.approvals ?? new AgentApprovalManager()
    this.ledger = options.idempotency ?? new AgentIdempotencyLedger()
  }

  async execute(request: AgentToolExecuteRequest): Promise<AgentToolGatewayResult> {
    const startedAt = Date.now()
    const definition = this.options.registry.get(request.toolName)
    if (!definition) throw new AgentToolGatewayError('UNKNOWN_TOOL', `未注册工具：${request.toolName}`)
    if (definition.risk === 'R4') throw new AgentToolGatewayError('PERMISSION_DENIED', 'R4 工具禁止执行')

    try {
      assertJsonWithinLimits(request.input, TOOL_INPUT_LIMITS)
      const input = definition.inputSchema.parse(request.input)
      const context = this.options.getHostContext(request.runId)
      validateContext(definition, context, request.expectedRevisions)
      const executionContext = {
        runId: request.runId,
        threadId: request.threadId,
        toolCallId: request.toolCallId,
        signal: request.signal,
        hostContext: context,
      }
      const preview = definition.preview
        ? await definition.preview(input, executionContext)
        : createDefaultPreview(definition, input)
      const expectedRevisions = currentRevisions(context, definition.requiredContext)
      const ledgerKey = `${request.runId}:${request.toolCallId}:${definition.version}`
      const inputDigest = digestJson(input)
      const existing = this.ledger.lookup(ledgerKey, inputDigest)
      if (existing?.status === 'cached') {
        return agentToolGatewayResultSchema.parse({ status: 'completed', observation: existing.observation, cached: true })
      }

      if (requiresApproval(definition, request.explicitUserIntent)) {
        if (!request.approvalId) {
          const approval = this.approvals.create({
            runId: request.runId,
            toolCallId: request.toolCallId,
            definition,
            input,
            preview,
            expectedRevisions,
          })
          return agentToolGatewayResultSchema.parse({ status: 'approval_required', approval })
        }
        this.approvals.consume(
          request.approvalId,
          request.runId,
          request.toolCallId,
          definition,
          input,
          expectedRevisions
        )
      }

      const begun = this.ledger.begin(ledgerKey, inputDigest)
      if (begun.status === 'cached') {
        return agentToolGatewayResultSchema.parse({ status: 'completed', observation: begun.observation, cached: true })
      }

      const concurrencyKey = definition.concurrencyKey(input)
      if (this.locks.has(concurrencyKey)) {
        this.ledger.fail(ledgerKey)
        throw new AgentToolGatewayError('CONFLICT', `工具并发键冲突：${concurrencyKey}`, true, 'wait')
      }
      this.locks.add(concurrencyKey)
      logger.info('Agent 工具执行开始', {
        event: 'agent_tool.execute.started',
        requestId: request.runId,
        taskId: request.toolCallId,
        context: { toolName: definition.name, version: definition.version, risk: definition.risk },
      })

      const linked = createLinkedController(request.signal, definition.timeoutMs)
      try {
        const output = await this.executeWithRetry(definition, input, { ...executionContext, signal: linked.controller.signal })
        throwIfAborted(linked.controller.signal)
        assertJsonWithinLimits(output, TOOL_OUTPUT_LIMITS)
        const parsedOutput = definition.outputSchema.parse(output)
        const dataClasses = definition.dataClasses(parsedOutput)
        if (dataClasses.includes('C3')) {
          throw new AgentToolGatewayError('PERMISSION_DENIED', '工具结果包含 C3 秘密数据，禁止进入 Agent 上下文')
        }
        const observation = agentToolObservationSchema.parse({
          source: { toolName: definition.name, toolVersion: definition.version, toolCallId: request.toolCallId },
          trust: 'untrusted_observation',
          dataClasses,
          summary: summarizeSafeText(definition.summarize(parsedOutput)),
          output: parsedOutput,
          undo: definition.undo?.(parsedOutput),
        })
        this.ledger.succeed(ledgerKey, observation)
        logger.info('Agent 工具执行完成', {
          event: 'agent_tool.execute.completed',
          requestId: request.runId,
          taskId: request.toolCallId,
          context: { toolName: definition.name, durationMs: Date.now() - startedAt, cached: false },
        })
        return agentToolGatewayResultSchema.parse({ status: 'completed', observation, cached: false })
      } catch (error) {
        if (!definition.readOnly && linked.controller.signal.aborted) this.ledger.markUnknown(ledgerKey)
        else this.ledger.fail(ledgerKey)
        throw error
      } finally {
        linked.dispose()
        this.locks.delete(concurrencyKey)
      }
    } catch (error) {
      const gatewayError = toGatewayError(error)
      logger.error('Agent 工具执行失败', {
        event: 'agent_tool.execute.failed',
        requestId: request.runId,
        taskId: request.toolCallId,
        context: { toolName: request.toolName, durationMs: Date.now() - startedAt, errorCode: gatewayError.code },
      })
      throw gatewayError
    }
  }

  private async executeWithRetry(
    definition: AgentToolDefinition,
    input: unknown,
    context: Parameters<AgentToolDefinition['execute']>[1]
  ): Promise<unknown> {
    const retries = definition.readOnly || definition.idempotent ? definition.retryPolicy.maxRetries : 0
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      throwIfAborted(context.signal)
      try {
        return await definition.execute(input, context)
      } catch (error) {
        const gatewayError = toGatewayError(error)
        if (!gatewayError.retryable || attempt >= retries) throw gatewayError
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, definition.retryPolicy.baseDelayMs * (attempt + 1))
          context.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('CANCELLED'))
          }, { once: true })
        })
      }
    }
    throw new AgentToolGatewayError('EXECUTION_FAILED', '工具重试状态异常')
  }
}
