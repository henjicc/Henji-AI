import {
  agentToolObservationSchema,
  type AgentToolObservation,
} from '../../../../../src/core/assistant/toolContracts'
import {
  hostScopeRevisionsSchema,
  type HostScopeRevisions,
} from '../../../../../src/core/assistant/hostContracts'
import type { SerializedAgentError } from '../../../../../src/core/assistant/events'
import type {
  ModelStepMessage,
  ModelStepToolCall,
} from '@henjicc/ai-sdk'
import { parseModelProviderError } from '@henjicc/ai-sdk'
import { resolveToolOffloadByteThreshold, shouldOffloadObservation } from '../context/offload'
import { AGENT_DISCOVERY_LEASE_TOOL_LIMIT } from '../../../../../src/core/assistant/toolBudget'
import { sanitizeObservationValue } from '../context/sanitize'
import { AgentToolGatewayError } from '../tools/gateway'
import { AgentBudgetExceededError } from './budget'

export function errorCode(error: unknown): string {
  const providerError = parseModelProviderError(error)
  if (providerError) return providerError.code
  if (error instanceof AgentToolGatewayError || error instanceof AgentBudgetExceededError) return error.code
  if (error instanceof Error) return error.message.match(/^\[([^\]]+)\]/)?.[1] ?? error.name
  return 'INTERNAL_ERROR'
}

export function serializeError(error: unknown): SerializedAgentError {
  const code = errorCode(error)
  const providerError = parseModelProviderError(error)
  if (providerError) {
    return {
      code,
      message: providerError.message,
      retryable: providerError.retryable,
      recovery: providerError.retryable ? 'wait' : 'none',
    }
  }
  const message = error instanceof Error ? error.message.replace(/^\[[^\]]+\]\s*/, '') : 'Agent 运行失败'
  const stoppedByPolicy = error instanceof AgentBudgetExceededError
  return {
    code,
    message: message.slice(0, 1_000) || 'Agent 运行失败',
    retryable: error instanceof AgentToolGatewayError ? error.retryable : false,
    recovery: error instanceof AgentToolGatewayError
      ? error.recovery
      : stoppedByPolicy ? 'user_action' : 'none',
  }
}

/** 工具失败信封 `{ ok: false, error: { code } }`。 */
export function failureEnvelope(output: unknown): {
  code: string
  message?: string
  retryable?: boolean
  recovery?: string
} | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  const record = output as Record<string, unknown>
  if (record.ok !== false) return null
  const error = record.error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null
  const value = error as Record<string, unknown>
  if (typeof value.code !== 'string') return null
  return {
    code: value.code,
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
    ...(typeof value.retryable === 'boolean' ? { retryable: value.retryable } : {}),
    ...(typeof value.recovery === 'string' ? { recovery: value.recovery } : {}),
  }
}

export interface ObservationFailure {
  code: string
  message: string
  retryable: boolean
  recovery: string
}

/** 从观察里读出结构化失败；不是失败就返回 null。 */
export function observationFailure(
  observation: AgentToolObservation
): ObservationFailure | null {
  const failure = failureEnvelope(observation.output)
  if (!failure) return null
  return {
    code: failure.code,
    message: failure.message ?? observation.summary,
    retryable: failure.retryable ?? false,
    recovery: failure.recovery ?? 'none',
  }
}

/**
 * 结果进入历史前先做一次投影，投影失败就退回原样。
 *
 * 投影函数由领域侧声明（见 ApplicationCapabilityDefinition.projectForHistory），签名按能力自己的
 * output schema 写。但网关在工具失败时返回的是 `{ ok: false, error }` 信封，形状与 schema 完全
 * 不同——实测库里就有两条能力发现失败结果会让投影函数直接抛 TypeError。失败信封本来也没有可裁的
 * 体积，先判掉比让 catch 静默吞掉更诚实。
 *
 * catch 仍然保留作最后一道：一个字段裁剪出错不该掀翻整次运行，退回完整结果只是上下文变大。
 */
function projectHistoryOutput(
  call: ModelStepToolCall,
  observation: AgentToolObservation,
  resolveProjection?: AgentHistoryProjectionResolver
): unknown {
  if (failureEnvelope(observation.output)) return observation.output
  const project = resolveProjection?.(call.toolName)
  if (!project) return observation.output
  try {
    const projected = project(observation.output)
    return projected === undefined ? observation.output : projected
  } catch {
    return observation.output
  }
}

/** 按工具名解析历史投影函数；由 runner 从工具注册表注入，避免结果层反向依赖 registry。 */
export type AgentHistoryProjectionResolver = (
  toolName: string
) => ((output: unknown) => unknown) | undefined

export function toolMessage(
  call: ModelStepToolCall,
  observation: AgentToolObservation,
  contextWindow?: number | null,
  resolveProjection?: AgentHistoryProjectionResolver
): ModelStepMessage {
  // 门槛按本轮真实上下文窗口算：窗口大就直接内联，避免“结果过早卸载 → 模型看不到内容
  // → 逐页读回来”的循环。按工具的内联下限见 offload.ts，观察层与这里共用同一个函数。
  const offloadThreshold = resolveToolOffloadByteThreshold(call.toolName, contextWindow)
  // 卸载判定量的必须是**投影后**的体积：先裁再判，一份裁完只剩 7KB 的目录就不该被推去分页。
  const projected = projectHistoryOutput(call, observation, resolveProjection)
  const output = shouldOffloadObservation(projected, offloadThreshold)
    ? { summary: observation.summary, largeResultOmitted: true }
    : { summary: observation.summary, data: sanitizeObservationValue(projected) }
  // 租约一律从**完整** output 提取：投影只决定模型看到什么，不能影响跨运行的租约恢复。
  const outputRecord = observation.output
    && typeof observation.output === 'object'
    && !Array.isArray(observation.output)
      ? observation.output as Record<string, unknown>
      : null
  const rawLeasedToolNames = outputRecord?.leasedToolNames
  const leasedToolNames = Array.isArray(rawLeasedToolNames)
    ? rawLeasedToolNames
        .filter((name: unknown): name is string => typeof name === 'string')
        .slice(0, AGENT_DISCOVERY_LEASE_TOOL_LIMIT)
    : []
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: { type: 'json', value: output },
      ...(leasedToolNames.length > 0 ? { leasedToolNames } : {}),
    }],
  }
}

export function rejectedObservation(call: ModelStepToolCall): AgentToolObservation {
  return agentToolObservationSchema.parse({
    source: { toolName: call.toolName, toolVersion: 1, toolCallId: call.toolCallId },
    trust: 'untrusted_observation',
    dataClasses: ['C0'],
    summary: '用户拒绝了本次工具调用。',
    output: { ok: false, error: { code: 'APPROVAL_REJECTED' } },
  })
}

export function extractResultReferences(output: unknown): Record<string, string> | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined
  const record = output as Record<string, unknown>
  const references: Record<string, string> = {}
  const referenceKeys = [
    'taskId', 'projectId', 'nodeId', 'edgeId', 'undoRef', 'workspace', 'workspaceId', 'surfaceId', 'modelId',
    'assetId', 'libraryId', 'previewRef', 'objectId', 'stateKeyframeId', 'workflowId', 'workflowRunId',
  ] as const
  for (const key of referenceKeys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) references[key] = value.slice(0, 500)
  }
  const nestedTask = record.task
  if (!references.taskId && nestedTask && typeof nestedTask === 'object' && !Array.isArray(nestedTask)) {
    const nestedRecord = nestedTask as Record<string, unknown>
    const taskId = nestedRecord.taskId ?? nestedRecord.id
    if (typeof taskId === 'string' && taskId.trim()) references.taskId = taskId.slice(0, 500)
  }
  for (const key of ['ref', 'sourceRef', 'resultRef'] as const) {
    const value = record[key]
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const ref = value as Record<string, unknown>
    if (typeof ref.kind === 'string' && typeof ref.id === 'string') {
      references[`${key}Kind`] = ref.kind.slice(0, 80)
      references[`${key}Id`] = ref.id.slice(0, 500)
    }
  }
  const bounded = Object.fromEntries(Object.entries(references).slice(0, 8))
  return Object.keys(bounded).length > 0 ? bounded : undefined
}

export function extractResultScopeRevisions(output: unknown): HostScopeRevisions | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  const parsed = hostScopeRevisionsSchema.safeParse((output as Record<string, unknown>).scopeRevisions)
  return parsed.success ? parsed.data : null
}
