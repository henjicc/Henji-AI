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
} from '../../../../../src/core/llm/modelStep'
import { parseModelProviderError } from '../../../../../src/core/llm/providerProtocol'
import { resolveOffloadByteThreshold, shouldOffloadObservation } from '../context/offload'
import {
  AGENT_DISCOVERY_LEASE_TOOL_LIMIT,
  AGENT_FACET_LEASE_TOOL_LIMIT,
} from '../../../../../src/core/assistant/toolBudget'
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

export function toolMessage(
  call: ModelStepToolCall,
  observation: AgentToolObservation,
  contextWindow?: number | null
): ModelStepMessage {
  // 门槛按本轮真实上下文窗口算：窗口大就直接内联，避免“结果过早卸载 → 模型看不到内容
  // → 逐页读回来”的循环。模型目录另有 24 KiB 下限，保证候选一次到位。
  const resolved = resolveOffloadByteThreshold(contextWindow)
  const offloadThreshold = call.toolName === 'search_models'
    ? Math.max(24 * 1024, resolved)
    : resolved
  const output = shouldOffloadObservation(observation.output, offloadThreshold)
    ? { summary: observation.summary, largeResultOmitted: true }
    : { summary: observation.summary, data: sanitizeObservationValue(observation.output) }
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
  const leasedSet = new Set(leasedToolNames)
  const rawFacets = Array.isArray(outputRecord?.facets) ? outputRecord.facets : []
  const toolLeases = rawFacets.flatMap((rawFacet) => {
    const facet = rawFacet && typeof rawFacet === 'object' && !Array.isArray(rawFacet)
      ? rawFacet as Record<string, unknown>
      : null
    if (typeof facet?.facetId !== 'string' || !Array.isArray(facet.capabilityNames)) return []
    const toolNames = facet.capabilityNames.filter((name): name is string => (
      typeof name === 'string' && leasedSet.has(name)
    )).slice(0, AGENT_FACET_LEASE_TOOL_LIMIT)
    return toolNames.length > 0 ? [{ facetId: facet.facetId, toolNames }] : []
  })
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: { type: 'json', value: output },
      ...(leasedToolNames.length > 0 ? { leasedToolNames } : {}),
      ...(toolLeases.length > 0 ? { toolLeases } : {}),
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
    'assetId', 'libraryId', 'previewRef', 'objectId', 'shotId', 'workflowId', 'workflowRunId',
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
