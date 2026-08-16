import { z } from 'zod'

import type { HostContextSnapshot, HostScope, HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolErrorCode, AgentToolPreview } from '../../../../../src/core/assistant/toolContracts'
import { AgentApprovalError } from './approval'
import { AgentIdempotencyConflictError } from './idempotency'
import { AgentPermissionAuditUnavailableError } from './permission-audit'
import type { AgentToolDefinition, AgentToolExecuteRequest } from './types'

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

export function toGatewayError(error: unknown): AgentToolGatewayError {
  if (error instanceof AgentToolGatewayError) return error
  if (error instanceof AgentApprovalError) {
    return new AgentToolGatewayError(error.code, error.message, false, 'request_approval')
  }
  if (error instanceof AgentIdempotencyConflictError) {
    return new AgentToolGatewayError('CONFLICT', error.message, false, 'user_action')
  }
  if (error instanceof AgentPermissionAuditUnavailableError) {
    return new AgentToolGatewayError(error.code, error.message, true, 'wait')
  }
  if (error instanceof z.ZodError) {
    return new AgentToolGatewayError('INVALID_INPUT', '工具参数或结果未通过 schema 校验')
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('JSON_')) {
    return new AgentToolGatewayError('INVALID_INPUT', '工具参数或预览超过安全限制')
  }
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
  if (hostErrorCode === 'NOT_FOUND' || hostErrorCode?.endsWith('_NOT_FOUND')) {
    return new AgentToolGatewayError('NOT_FOUND', message, false, 'user_action')
  }
  if (hostErrorCode === 'INVALID_INPUT') {
    return new AgentToolGatewayError('INVALID_INPUT', message, true, 'user_action')
  }
  if (hostErrorCode === 'CONFLICT') {
    return new AgentToolGatewayError('CONFLICT', message, true, 'refresh_context')
  }
  if (hostErrorCode === 'PERMISSION_DENIED') {
    return new AgentToolGatewayError('PERMISSION_DENIED', message, false, 'user_action')
  }
  if (hostErrorCode === 'CAPABILITY_NOT_READY') {
    return new AgentToolGatewayError('NOT_READY', message, true, 'wait')
  }
  return new AgentToolGatewayError('EXECUTION_FAILED', message || '工具执行失败')
}

export function currentRevisions(
  context: HostContextSnapshot | null,
  scopes: HostScope[]
): Record<string, number> {
  if (!context) return {}
  return Object.fromEntries(scopes.map((scope) => [scope, context.scopeRevisions[scope]]))
}

export function requiredContextForInput(
  definition: AgentToolDefinition,
  input: unknown
): HostScope[] {
  return [...new Set(definition.resolveRequiredContext?.(input) ?? definition.requiredContext)]
}

export function validateContext(
  requiredContext: HostScope[],
  context: HostContextSnapshot | null,
  expected: Partial<HostScopeRevisions> | undefined
): void {
  if (requiredContext.length > 0 && (!context || !context.uiReady)) {
    throw new AgentToolGatewayError('NOT_READY', '宿主界面尚未就绪', true, 'wait')
  }
  if (!context || !expected) return
  for (const scope of requiredContext) {
    const expectedValue = expected[scope]
    if (expectedValue !== undefined && context.scopeRevisions[scope] !== expectedValue) {
      throw new AgentToolGatewayError('STALE_CONTEXT', `宿主 ${scope} 上下文已变化`, true, 'refresh_context')
    }
  }
}

export function createDefaultPreview(
  definition: AgentToolDefinition,
  input: unknown
): AgentToolPreview {
  return {
    title: definition.title,
    summary: `${definition.title} 将作用于 ${Object.keys(definition.targetIds(input)).length || 1} 个明确目标。`,
    targetIds: definition.targetIds(input),
    reversible: definition.supportsUndo,
    dataClasses: ['C1'],
  }
}

export function assertPreviewDataBoundary(preview: AgentToolPreview): void {
  if (preview.dataClasses.includes('C2') && !preview.destination) {
    throw new AgentToolGatewayError('INVALID_INPUT', 'C2 敏感数据预览必须明确数据目的地')
  }
}

const dataClassRank = { C0: 0, C1: 1, C2: 2, C3: 3 } as const

function highestDataClassRank(items: Array<keyof typeof dataClassRank>): number {
  return items.reduce((highest, item) => Math.max(highest, dataClassRank[item]), 0)
}

export function assertOutputDataClassesCovered(
  preview: AgentToolPreview,
  actual: Array<keyof typeof dataClassRank>
): void {
  const previewRank = highestDataClassRank(preview.dataClasses)
  const actualRank = highestDataClassRank(actual)
  if (actualRank > previewRank) {
    throw new AgentToolGatewayError(
      'PERMISSION_DENIED',
      '工具结果的数据级别高于已审批预览，禁止进入 Agent 上下文'
    )
  }
}

export function validateAuthorizationSource(request: AgentToolExecuteRequest): void {
  const source = request.authorizationSource ?? 'direct'
  if (['approved_workflow', 'approved_program', 'approved_script'].includes(source) && !request.parentToolCallId) {
    throw new AgentToolGatewayError('INVALID_INPUT', '受控编排委托缺少父工具调用 ID')
  }
  if (source === 'direct' && request.parentToolCallId) {
    throw new AgentToolGatewayError('INVALID_INPUT', '直接工具调用不能携带父工具调用 ID')
  }
}

export function createLinkedController(
  parent: AbortSignal,
  timeoutMs: number
): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort('CANCELLED')
  if (parent.aborted) controller.abort('CANCELLED')
  else parent.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort('TIMEOUT'), timeoutMs)
  return {
    controller,
    dispose: () => {
      clearTimeout(timeout)
      parent.removeEventListener('abort', onAbort)
    },
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw new Error(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED')
}

export async function executeToolWithRetry(
  definition: AgentToolDefinition,
  input: unknown,
  context: Parameters<AgentToolDefinition['execute']>[1]
): Promise<unknown> {
  const retries = definition.readOnly || definition.idempotent
    ? definition.retryPolicy.maxRetries
    : 0
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
