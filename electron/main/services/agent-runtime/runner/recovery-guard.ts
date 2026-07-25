import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { AgentToolRegistry } from '../tools/registry'

interface RecoveryGuardState {
  toolName: string | null
  toolCategory: string | null
}

interface SameModelParameterRecoveryState {
  sourceTaskId: string
  sourceModelId: string
  parametersPrepared: boolean
  correctionTaskId: string | null
  correctionTaskObserved: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function inputModelId(call: ModelStepToolCall): string | null {
  const modelId = asRecord(call.input)?.modelId
  return typeof modelId === 'string' && modelId.length > 0 ? modelId : null
}

function observationSucceeded(observation: AgentToolObservation): boolean {
  if (!observation.output || typeof observation.output !== 'object' || Array.isArray(observation.output)) {
    return true
  }
  return Reflect.get(observation.output, 'ok') !== false
}

export class AgentRecoveryWriteGuard {
  private state: RecoveryGuardState | null
  private sameModelParameterRecovery: SameModelParameterRecoveryState | null = null

  constructor(
    summary: AgentWorkingSummary | undefined,
    private readonly registry: AgentToolRegistry
  ) {
    this.state = summary?.recovery.mode === 'verify_before_write'
      ? {
          toolName: summary.recovery.toolName,
          toolCategory: summary.recovery.toolCategory,
        }
      : null
  }

  validate(call: ModelStepToolCall): string | null {
    const parameterRecoveryReason = this.validateSameModelParameterRecovery(call)
    if (parameterRecoveryReason) return parameterRecoveryReason
    if (!this.state) return null
    const definition = this.registry.get(call.toolName)
    if (!definition || definition.readOnly) return null
    return [
      `恢复检查尚未完成，禁止执行写工具 ${call.toolName}。`,
      this.state.toolCategory
        ? `请先调用 ${this.state.toolCategory} 领域的只读状态工具确认上次操作是否生效。`
        : '请先调用同一业务领域的只读状态工具确认上次操作是否生效。',
    ].join('')
  }

  consumeVerification(call: ModelStepToolCall, observation: AgentToolObservation): boolean {
    if (!this.state || !observationSucceeded(observation)) return false
    const definition = this.registry.get(call.toolName)
    if (!definition?.readOnly) return false
    if (this.state.toolCategory && definition.category !== this.state.toolCategory) return false
    this.state = null
    return true
  }

  observe(call: ModelStepToolCall, observation: AgentToolObservation): void {
    const output = asRecord(observation.output)
    const task = asRecord(output?.task)
    const recovery = asRecord(task?.recovery)
    if (call.toolName === 'get_generation_task'
      && recovery?.strategy === 'correct_same_model_parameters'
      && typeof recovery.sourceTaskId === 'string'
      && typeof recovery.sourceModelId === 'string') {
      this.sameModelParameterRecovery = {
        sourceTaskId: recovery.sourceTaskId,
        sourceModelId: recovery.sourceModelId,
        parametersPrepared: false,
        correctionTaskId: null,
        correctionTaskObserved: false,
      }
      return
    }

    const state = this.sameModelParameterRecovery
    if (!state) return
    if (call.toolName === 'prepare_generation_task' && inputModelId(call) === state.sourceModelId) {
      const preparation = asRecord(output?.preparation)
      state.parametersPrepared = preparation?.prepared === true && preparation.modelId === state.sourceModelId
      return
    }
    if (call.toolName === 'create_visible_generation_task' && inputModelId(call) === state.sourceModelId) {
      const taskId = output?.taskId
      if (typeof taskId === 'string' && taskId.length > 0) state.correctionTaskId = taskId
      return
    }
    if (call.toolName === 'get_generation_task' && typeof task?.taskId === 'string' && task.taskId === state.correctionTaskId) {
      state.correctionTaskObserved = true
      if (['success', 'completed', 'succeeded'].includes(String(task.status).toLowerCase())) {
        this.sameModelParameterRecovery = null
      }
    }
  }

  private validateSameModelParameterRecovery(call: ModelStepToolCall): string | null {
    const state = this.sameModelParameterRecovery
    if (!state) return null
    const modelId = inputModelId(call)
    if (call.toolName === 'search_models') {
      return `任务 ${state.sourceTaskId} 的供应商参数错误尚未按原模型修正；禁止搜索替代模型。请使用 ${state.sourceModelId} 的 schema 修正参数。`
    }
    if (['get_model_schema', 'prepare_generation_task'].includes(call.toolName) && modelId !== state.sourceModelId) {
      return `任务 ${state.sourceTaskId} 必须保留模型 ${state.sourceModelId} 修正参数；禁止读取替代模型。`
    }
    if (call.toolName === 'create_visible_generation_task') {
      if (modelId !== state.sourceModelId) {
        return `任务 ${state.sourceTaskId} 必须保留模型 ${state.sourceModelId} 修正参数；禁止创建替代模型任务。`
      }
      if (!state.parametersPrepared) {
        return `必须先读取模型 ${state.sourceModelId} 的 schema 并成功 prepare 修正参数，才能重新提交任务。`
      }
      if (state.correctionTaskId) {
        return `模型 ${state.sourceModelId} 的修正任务 ${state.correctionTaskId} 已提交；不得再次创建相同恢复任务。`
      }
    }
    if (call.toolName === 'get_generation_task'
      && asRecord(call.input)?.taskId === state.correctionTaskId
      && state.correctionTaskObserved) {
      return `修正任务 ${state.correctionTaskId} 已读取过；不要在同一 Agent 运行中立即重复轮询。`
    }
    return null
  }
}
