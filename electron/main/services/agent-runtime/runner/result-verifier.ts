import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentRouteDecision } from '../context/types'
import { extractResultReferences } from './runner-results'

interface ObservationFailure {
  code: string
  message: string
  retryable: boolean
  recovery: string
}

export interface AgentCompletionVerification {
  passed: boolean
  summary: string
  evidence: string[]
  clarificationRequired: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function observationFailure(observation: AgentToolObservation): ObservationFailure | null {
  const output = asRecord(observation.output)
  if (output?.ok !== false) return null
  const error = asRecord(output.error)
  if (!error || typeof error.code !== 'string') return null
  return {
    code: error.code,
    message: typeof error.message === 'string' ? error.message : observation.summary,
    retryable: error.retryable === true,
    recovery: typeof error.recovery === 'string' ? error.recovery : 'none',
  }
}

function generationStatus(observations: AgentToolObservation[]): string | null {
  for (const observation of [...observations].reverse()) {
    if (observation.source.toolName === 'get_generation_task') {
      const task = asRecord(asRecord(observation.output)?.task)
      if (typeof task?.status === 'string') return task.status.toLowerCase()
    }
    if (observation.source.toolName === 'create_visible_generation_task') {
      const status = asRecord(observation.output)?.status
      if (typeof status === 'string') return status.toLowerCase()
    }
  }
  return null
}

function hasWriteEvidence(observation: AgentToolObservation): boolean {
  const output = asRecord(observation.output)
  if (!output) return false
  if (extractResultReferences(output)) return true
  return typeof output.revision === 'number'
    || typeof output.status === 'string'
    || typeof output.updatedAt === 'string'
    || typeof output.version === 'number'
    || Boolean(asRecord(output.scopeRevisions))
}

function explainsFailure(finalText: string, failure: ObservationFailure): boolean {
  const normalized = finalText.toLowerCase()
  if (['APPROVAL_REJECTED', 'APPROVAL_EXPIRED', 'CANCELLED'].includes(failure.code)) {
    return /拒绝|过期|取消|未执行|没有执行/.test(finalText)
  }
  return /无法|失败|未找到|不存在|需要|请提供|请确认|参数|权限|稍后/.test(finalText)
    || normalized.includes(failure.code.toLowerCase())
}

function needsClarification(finalText: string, failure: ObservationFailure): boolean {
  return ['NOT_FOUND', 'INVALID_INPUT', 'PERMISSION_DENIED'].includes(failure.code)
    && (/请提供|请确认|请选择|需要你|[?？]/.test(finalText))
}

export function buildRecoveryGuidance(
  observations: AgentToolObservation[],
  registry: AgentToolRegistry
): string | null {
  const failures = observations.flatMap((observation) => {
    const failure = observationFailure(observation)
    return failure ? [{ observation, failure }] : []
  })
  if (failures.length === 0) return null
  const guidance = failures.map(({ observation, failure }) => {
    const definition = registry.get(observation.source.toolName)
    const writeMayHaveUnknownSideEffect = Boolean(definition && !definition.readOnly)
      && ['TIMEOUT', 'EXECUTION_FAILED', 'CANCELLED'].includes(failure.code)
    if (writeMayHaveUnknownSideEffect) {
      return `${observation.source.toolName} 返回 ${failure.code}：写入副作用未知，禁止自动重放；先查询真实状态，无法确认时向用户说明。`
    }
    if (['STALE_CONTEXT', 'CONFLICT'].includes(failure.code)) {
      return `${observation.source.toolName} 返回 ${failure.code}：下一轮使用最新宿主快照和 revision 重新规划，不得覆盖用户的新修改。`
    }
    if (['TIMEOUT', 'NOT_READY'].includes(failure.code)) {
      return `${observation.source.toolName} 返回 ${failure.code}：只读或幂等操作可有限重试；仍失败时说明等待条件。`
    }
    if (['NOT_FOUND', 'INVALID_INPUT'].includes(failure.code)) {
      return `${observation.source.toolName} 返回 ${failure.code}：重新读取目录/schema 并修正稳定 ID 或参数；目标仍不唯一时向用户提出一个具体问题。`
    }
    if (['APPROVAL_REJECTED', 'APPROVAL_EXPIRED', 'PERMISSION_DENIED'].includes(failure.code)) {
      return `${observation.source.toolName} 返回 ${failure.code}：不得绕过或重复请求授权；清楚说明操作未执行及用户可选下一步。`
    }
    return `${observation.source.toolName} 返回 ${failure.code}：不要声称成功；尝试安全替代方案，或说明无法继续的具体原因。`
  })
  return ['[结构化失败恢复要求]', ...guidance].join('\n')
}

export function verifyAgentCompletion(input: {
  route: AgentRouteDecision
  finalText: string
  observations: AgentToolObservation[]
  registry: AgentToolRegistry
}): AgentCompletionVerification {
  if (input.route.intent === 'general' && input.observations.length === 0) {
    const clarificationRequired = input.route.complexity === 'ambiguous'
      && /请提供|请确认|请选择|需要你|[?？]/.test(input.finalText)
    return {
      passed: true,
      summary: clarificationRequired
        ? '模糊目标已转换为清晰的用户问题，未执行写操作。'
        : '一般回答不需要工具证据。',
      evidence: [],
      clarificationRequired,
    }
  }
  if (input.observations.length === 0) {
    return { passed: false, summary: '缺少任何工具观察，无法证明任务完成。', evidence: [], clarificationRequired: false }
  }

  let lastFailure: { index: number; failure: ObservationFailure } | null = null
  let lastSuccessIndex = -1
  const successful: AgentToolObservation[] = []
  input.observations.forEach((observation, index) => {
    const failure = observationFailure(observation)
    if (failure) {
      lastFailure = { index, failure }
      return
    }
    lastSuccessIndex = index
    successful.push(observation)
  })
  const unresolvedFailure = lastFailure as { index: number; failure: ObservationFailure } | null
  if (unresolvedFailure && unresolvedFailure.index > lastSuccessIndex) {
    const explained = explainsFailure(input.finalText, unresolvedFailure.failure)
    const clarificationRequired = explained && needsClarification(input.finalText, unresolvedFailure.failure)
    return {
      passed: explained,
      summary: explained
        ? `最终答复如实说明 ${unresolvedFailure.failure.code}，未宣称动作成功。`
        : `最近工具失败 ${unresolvedFailure.failure.code} 尚未恢复或向用户说明。`,
      evidence: [`error:${unresolvedFailure.failure.code}`],
      clarificationRequired,
    }
  }

  const writeWithoutEvidence = successful.find((observation) => {
    const definition = input.registry.get(observation.source.toolName)
    return definition && !definition.readOnly && !hasWriteEvidence(observation)
  })
  if (writeWithoutEvidence) {
    return {
      passed: false,
      summary: `${writeWithoutEvidence.source.toolName} 缺少稳定结果引用、状态或 revision。`,
      evidence: [],
      clarificationRequired: false,
    }
  }

  const status = generationStatus(successful)
  if (status) {
    const completed = ['completed', 'succeeded', 'success'].includes(status)
    const claimsSuccess = /生成成功|已生成完成|生成已完成|已经生成完毕/.test(input.finalText)
    if (!completed && claimsSuccess) {
      return {
        passed: false,
        summary: `生成任务真实状态为 ${status}，最终答复却声称生成成功。`,
        evidence: [`generation_status:${status}`],
        clarificationRequired: false,
      }
    }
  }

  const evidence = successful.slice(-8).map((observation) => {
    const references = extractResultReferences(observation.output)
    const suffix = references ? `:${Object.entries(references).map(([key, value]) => `${key}=${value}`).join(',')}` : ''
    return `${observation.source.toolName}${suffix}`
  })
  return {
    passed: true,
    summary: '工具观察和最终答复具有一致的结构化完成证据。',
    evidence,
    clarificationRequired: false,
  }
}
