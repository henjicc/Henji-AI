import { z } from 'zod'

import type { HostContextSnapshot, HostScope, HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolErrorCode, AgentToolPreview } from '../../../../../src/core/assistant/toolContracts'
import { AgentApprovalError } from './approval'
import { AgentIdempotencyConflictError } from './idempotency'
import { AgentPermissionAuditUnavailableError } from './permission-audit'
import { redactAgentText } from './security'
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

/**
 * 把 zod 的校验问题如实说给模型，而不是回一句"未通过 schema 校验"。
 *
 * 旧文案不带任何定位信息。模型收到它只能盲猜哪里错了——实测一次 canvas 运行里
 * read_agent_artifact 连续 11 次 INVALID_INPUT（每次 durationMs 都是 0，说明卡在入参校验、
 * 根本没进执行），模型改一个字段试一次，直到 CONSECUTIVE_FAILURES 把整次运行判死。
 *
 * 最常见的两种错法都能被这条消息直接点破：`.strict()` 下多传一个键（unrecognized_keys 会
 * 列出键名），以及必填项缺失或类型不符（path 指到具体字段）。这属于把事实给全，不是加提示词。
 */
/** 沿 issue.path 取出模型实际传进来的那个值，取不到返回 undefined。 */
function valueAtPath(input: unknown, path: PropertyKey[]): unknown {
  let current = input
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<PropertyKey, unknown>)[key]
  }
  return current
}

/** 把实际收到的值压成一句能读的话：类型 + 截断后的内容。 */
function describeReceived(value: unknown): string {
  if (value === undefined) return '实际没有传这个字段'
  const type = value === null ? 'null' : Array.isArray(value) ? `数组（${value.length} 项）` : typeof value
  let rendered: string
  try {
    rendered = JSON.stringify(value) ?? String(value)
  } catch {
    return `实际收到 ${type}`
  }
  const clipped = rendered.length > 200 ? `${rendered.slice(0, 200)}…` : rendered
  return `实际收到 ${type}：${clipped}`
}

/**
 * 把 zod 的校验问题如实说给模型，而不是回一句"未通过 schema 校验"。
 *
 * 旧文案不带任何定位信息。模型收到它只能盲猜哪里错了——实测一次 canvas 运行里
 * read_agent_artifact 连续 11 次 INVALID_INPUT（每次 durationMs 都是 0，说明卡在入参校验、
 * 根本没进执行），模型改一个字段试一次，直到 CONSECUTIVE_FAILURES 把整次运行判死。
 *
 * 最常见的两种错法都能被这条消息直接点破：`.strict()` 下多传一个键（unrecognized_keys 会
 * 列出键名），以及必填项缺失或类型不符（path 指到具体字段）。这属于把事实给全，不是加提示词。
 *
 * 但 zod 自己也有说不清的时候：`.refine()` 产出的 `custom` issue 默认消息就是干巴巴一句
 * "Invalid input"。实测生成场景第一次能力发现收到的原话是
 * 「queries：Invalid input；queries：Invalid input」——模型在推理里明说"这可能意味着整个
 * queries 数组无效，或者其中的元素无效？也许 queries 不能包含特殊字符？"，只能靠换写法蒙，
 * 白烧一个回合。zod 讲不出原因时，至少要把**模型实际传了什么**摆出来，让它自己对照 schema。
 */
function describeZodIssues(error: z.ZodError, input: unknown): string {
  const issues = error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(根对象)'
    if (issue.code === 'unrecognized_keys') {
      return `${path} 不接受这些字段：${issue.keys.join('、')}`
    }
    // zod 只会说 "Invalid input" 的那些 issue，补上实际值才有可能自纠。
    const uninformative = !/[:：]/.test(issue.message)
    if (!uninformative) return `${path}：${issue.message}`
    return `${path}：${issue.message}（${describeReceived(valueAtPath(input, [...issue.path]))}）`
  })
  const omitted = error.issues.length - issues.length
  return `工具参数未通过 schema 校验——${issues.join('；')}`
    + `${omitted > 0 ? `；另有 ${omitted} 处问题` : ''}。请按活动工具的 schema 修正后重试。`
}

/** 单个字符串值在日志里最多保留多少字符——够认出错在哪，又不至于把整段脚本写进日志。 */
const LOG_VALUE_MAX = 200

/**
 * 工具入参的日志投影：**键名全保留，值脱敏并截断**。
 *
 * 失败排查里最常需要的就是键名——`.strict()` 拒绝的是多出来的那个键，缺失报的是漏掉的那个键。
 * 值则可能含密钥或整段脚本，所以走 redactAgentText 再截断。
 */
export function redactToolInputForLog(input: unknown, depth = 0): unknown {
  if (typeof input === 'string') {
    const redacted = redactAgentText(input)
    return redacted.length > LOG_VALUE_MAX ? `${redacted.slice(0, LOG_VALUE_MAX)}…` : redacted
  }
  if (typeof input === 'number' || typeof input === 'boolean' || input === null) return input
  if (depth >= 4) return '[层级过深]'
  if (Array.isArray(input)) {
    return input.slice(0, 20).map((item) => redactToolInputForLog(item, depth + 1))
  }
  if (input && typeof input === 'object') {
    return Object.fromEntries(Object.entries(input as Record<string, unknown>)
      .slice(0, 40)
      .map(([key, value]) => [key, redactToolInputForLog(value, depth + 1)]))
  }
  return undefined
}

export function toGatewayError(error: unknown, input?: unknown): AgentToolGatewayError {
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
    return new AgentToolGatewayError('INVALID_INPUT', describeZodIssues(error, input))
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


