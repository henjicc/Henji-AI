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
import { shouldOffloadObservation } from '../context/offload'
import { sanitizeObservationValue } from '../context/sanitize'
import { AgentToolGatewayError } from '../tools/gateway'
import { AgentBudgetExceededError } from './budget'

export function errorCode(error: unknown): string {
  if (error instanceof AgentToolGatewayError || error instanceof AgentBudgetExceededError) return error.code
  if (error instanceof Error) return error.message.match(/^\[([^\]]+)\]/)?.[1] ?? error.name
  return 'INTERNAL_ERROR'
}

export function serializeError(error: unknown): SerializedAgentError {
  const code = errorCode(error)
  const message = error instanceof Error ? error.message.replace(/^\[[^\]]+\]\s*/, '') : 'Agent 运行失败'
  return {
    code,
    message: message.slice(0, 1_000) || 'Agent 运行失败',
    retryable: error instanceof AgentToolGatewayError ? error.retryable : false,
    recovery: error instanceof AgentToolGatewayError ? error.recovery : 'none',
  }
}

export function toolMessage(
  call: ModelStepToolCall,
  observation: AgentToolObservation
): ModelStepMessage {
  const output = shouldOffloadObservation(observation.output)
    ? { summary: observation.summary, largeResultOmitted: true }
    : { summary: observation.summary, data: sanitizeObservationValue(observation.output) }
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: { type: 'json', value: output },
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
    'taskId', 'projectId', 'nodeId', 'edgeId', 'undoRef', 'workspace', 'workspaceId', 'modelId',
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
  return Object.keys(references).length > 0 ? references : undefined
}

export function extractResultScopeRevisions(output: unknown): HostScopeRevisions | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  const parsed = hostScopeRevisionsSchema.safeParse((output as Record<string, unknown>).scopeRevisions)
  return parsed.success ? parsed.data : null
}
