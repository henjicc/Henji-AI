import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentRouteDecision } from '../context/types'
import { extractResultReferences } from './runner-results'
import type { AgentProgressSettlement } from '../../../../../src/core/assistant/progress'

interface ObservationFailure {
  code: string
  message: string
  retryable: boolean
  recovery: string
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

function generationTaskRecoveryGuidance(observations: AgentToolObservation[]): string | null {
  for (const observation of [...observations].reverse()) {
    if (observation.source.toolName !== 'get_generation_task') continue
    const task = asRecord(asRecord(observation.output)?.task)
    if (!task || typeof task.status !== 'string') continue
    const recovery = asRecord(task.recovery)
    if (recovery?.strategy === 'correct_same_model_parameters'
      && typeof recovery.sourceModelId === 'string'
      && typeof recovery.sourceTaskId === 'string') {
      return [
        `[生成任务参数恢复要求] 任务 ${recovery.sourceTaskId} 被供应商判定为参数错误。`,
        `必须保留模型 ${recovery.sourceModelId}，依次读取该模型 schema、修正允许值、prepare 后最多提交一次同模型修正任务。`,
        '禁止搜索、读取或创建替代模型；若当前模型无法满足用户明确要求，应向用户说明并请求选择。',
      ].join('')
    }
    if (['pending', 'queued', 'generating'].includes(task.status.toLowerCase())) {
      return `任务 ${typeof task.taskId === 'string' ? task.taskId : ''} 当前为 ${task.status}；不得在同一 Agent 运行中立即重复读取该任务，向用户说明已提交并可在生成工作区查看。`
    }
  }
  return null
}

/*
 * 这里曾经有一个 needsClarification()：用正则在模型的中文答复里找问号和"请提供/请确认"，
 * 据此决定运行要不要停下来等用户。它是全仓库进入 waiting_user 的唯一入口，两种失败都实测
 * 发生过——模型确实在问却没命中词表，运行直接 completed；答复里恰好有个问号，运行挂着等一个
 * 用户不知道要答什么的东西。
 *
 * 现在由模型显式调用 `ask_user` 触发（见 tools/builtin/ask-user.ts 与 runner 的
 * waitForUserAnswer）。判断"我需要问用户"是模型的判断题，运行时从散文里嗅不出来。
 */

export function buildRecoveryGuidance(
  observations: AgentToolObservation[],
  registry: AgentToolRegistry
): string | null {
  const failures = observations.flatMap((observation) => {
    const failure = observationFailure(observation)
    return failure ? [{ observation, failure }] : []
  })
  if (failures.length === 0) return generationTaskRecoveryGuidance(observations)
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
    if (failure.code === 'TOOL_NOT_ACTIVE') {
      return failure.retryable && failure.recovery === 'refresh_context'
        ? `${observation.source.toolName} 本轮未披露但已安排下一轮恢复：只在下一轮 schema 中出现后重试一次；若仍未出现则重新搜索能力或说明阻塞。`
        : `${observation.source.toolName} 未在活动工具集合中：重新搜索能力并等待下一轮披露，禁止继续动态调用。`
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

