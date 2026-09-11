import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { ModelStepToolCall } from '@henjicc/ai-sdk'
import type { AgentToolRegistry } from '../tools/registry'
import type { OperationRecord } from '../../../../../src/core/assistant/operations'

interface RecoveryGuardState {
  toolCallId: string | null
  toolName: string | null
  toolCategory: string | null
  entityTypes: string[]
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
          toolCallId: summary.recovery.toolCallId ?? null,
          toolCategory: summary.recovery.toolCategory,
          entityTypes: [],
        }
      : null
  }

  /** 同一运行内的未知写入也必须立即进入恢复态，不能只在重启恢复时从摘要初始化。 */
  activateUnknownWrite(call: ModelStepToolCall, toolCategory: string | null): void {
    const input = asRecord(call.input)
    const changes = Array.isArray(input?.changes) ? input.changes : []
    const entityTypes = changes.flatMap((change) => {
      const entityType = asRecord(change)?.entityType
      return typeof entityType === 'string' ? [entityType] : []
    })
    this.state = { toolName: call.toolName, toolCallId: call.toolCallId, toolCategory, entityTypes: [...new Set(entityTypes)] }
  }

  validate(call: ModelStepToolCall): string | null {
    const parameterRecoveryReason = this.validateSameModelParameterRecovery(call)
    if (parameterRecoveryReason) return parameterRecoveryReason
    if (!this.state) return null
    const definition = this.registry.get(call.toolName)
    if (!definition || definition.readOnly) return null
    return [
      `恢复检查尚未完成，禁止执行写工具 ${call.toolName}。`,
      '请核对原操作的正式回执及目标验证条件。同域其他对象或目录读取不能解除保护。',
    ].join('')
  }

  consumeVerification(_call: ModelStepToolCall, _observation: AgentToolObservation): boolean {
    // 普通读取没有原操作关联，不能证明未知调用是否执行。
    return false
  }

  reconcile(records: readonly OperationRecord[]): boolean {
    if (!this.state?.toolCallId) return false
    const original = records.find((record) => record.toolCallId === this.state?.toolCallId)
    if (!original) return false
    if (!original.container && original.businessMutation === false) { this.state = null; return true }
    const affected = original.container ? records.filter((record) => record.parentToolCallId === original.toolCallId && !record.readOnly && record.businessMutation !== false) : [original]
    if (!affected.length || affected.some((record) => record.state !== 'completed'
      || !record.verifications.length || record.verifications.some((verification) => verification.status !== 'passed'))) return false
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
