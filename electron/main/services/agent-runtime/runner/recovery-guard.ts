import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { AgentToolRegistry } from '../tools/registry'

interface RecoveryGuardState {
  toolName: string | null
  toolCategory: string | null
}

function observationSucceeded(observation: AgentToolObservation): boolean {
  if (!observation.output || typeof observation.output !== 'object' || Array.isArray(observation.output)) {
    return true
  }
  return Reflect.get(observation.output, 'ok') !== false
}

export class AgentRecoveryWriteGuard {
  private state: RecoveryGuardState | null

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
}
