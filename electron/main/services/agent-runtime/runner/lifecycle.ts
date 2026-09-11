import { createMainLogger } from '../../logging'
import {
  agentRunStateSchema,
  type AgentEvent,
  type AgentEventInput,
  type AgentRunState,
  type AgentRunStatus,
} from '../../../../../src/core/assistant/events'
import type { AgentRunnerDependencies } from './types'
import type { AgentRunMetrics } from './budget'
import { AgentEventStream } from './event-stream'
import { serializeError } from './runner-results'
import type { AgentStateMachine } from './state-machine'
import { reduceAgentWorkingSummary } from './working-summary'
import { agentObservedEffectSchema, type AgentObservedEffect } from '../../../../../src/core/assistant/observedEffect'
import type { ExecutionFactsProjection } from '../../../../../src/core/assistant/executionFacts'

const logger = createMainLogger('main.agent_runtime')

interface AgentRunnerLifecycleOptions {
  runId: string
  state: AgentRunState
  machine: AgentStateMachine
  budget: AgentRunMetrics
  dependencies: Pick<AgentRunnerDependencies, 'onEvent' | 'onCheckpoint' | 'onTerminal'>
  onEventDispatchError: (error: unknown) => void
}

export class AgentRunnerLifecycle {
  private readonly events: AgentEventStream

  constructor(private readonly options: AgentRunnerLifecycleOptions) {
    this.events = new AgentEventStream(options.runId, {
      onDispatchError: options.onEventDispatchError,
    })
    this.events.subscribe((event) => this.recordEmittedEvent(event))
  }

  getState(): AgentRunState {
    this.refreshState()
    return agentRunStateSchema.parse(this.options.state)
  }

  getEventHistory(): AgentEvent[] {
    return this.events.getHistory()
  }

  emit(input: AgentEventInput): void {
    this.events.emit(input)
  }

  transition(next: AgentRunStatus, reason?: string): void {
    const previous = this.options.machine.transition(next)
    this.options.state.status = next
    if (previous !== next) {
      this.emit({ type: 'RunStateChanged', previous, current: next, reason })
    }
  }

  complete(finalText: string): void {
    this.options.state.finalText = finalText
    this.options.state.presentationOutcome = { status: 'generated' }
    this.transition('completed')
    this.emit({ type: 'RunCompleted', finalText, usage: this.options.budget.snapshot() })
    logger.info('Agent 运行完成', {
      event: 'agent_runtime.run.completed',
      requestId: this.options.runId,
      context: {
        turns: this.options.budget.snapshot().turns,
        toolCalls: this.options.budget.snapshot().toolCalls,
      },
    })
    this.finishTerminal()
  }

  recordExecutionEffects(effects: AgentObservedEffect[]): void {
    if (this.options.state.executionOutcome.status !== 'pending' || effects.length === 0) return
    const merged = [...this.options.state.executionOutcome.effects, ...effects]
    this.options.state.executionOutcome = {
      ...this.options.state.executionOutcome,
      effects: merged.map((effect) => agentObservedEffectSchema.parse(effect)),
    }
  }

  recordExecutionProjection(projection: ExecutionFactsProjection): void {
    this.options.state.executionOutcome = {
      ...this.options.state.executionOutcome,
      effects: projection.effects,
      facts: projection.facts,
      verificationSummary: { summary: projection.summary, evidence: projection.evidence },
    }
    if (this.options.state.workingSummary) this.options.state.workingSummary.executionFacts = projection.facts
  }

  sealExecution(input: { effects: AgentObservedEffect[]; summary: string; evidence: string[] }): void {
    if (this.options.state.executionOutcome.status === 'sealed_success') return
    const sealedAt = new Date().toISOString()
    this.options.state.executionOutcome = {
      ...this.options.state.executionOutcome,
      status: 'sealed_success', effects: input.effects,
      verificationSummary: { summary: input.summary, evidence: input.evidence }, sealedAt,
    }
    this.emit({ type: 'ExecutionOutcomeSealed', ...input, facts: this.options.state.executionOutcome.facts })
  }

  completeWithWarning(finalText: string, error: unknown): void {
    const warning = serializeError(error)
    this.options.state.finalText = finalText
    this.options.state.error = null
    this.options.state.presentationOutcome = { status: 'fallback', warning }
    this.transition('completed_with_warning', warning.code)
    this.emit({ type: 'RunCompletedWithWarning', finalText, warning, usage: this.options.budget.snapshot() })
    logger.warn('Agent 执行事实已记录，最终说明降级', {
      event: 'agent_runtime.run.completed_with_warning', requestId: this.options.runId,
      context: { warningCode: warning.code, turns: this.options.budget.snapshot().turns },
    })
    this.finishTerminal()
  }

  completeWithFallback(error: unknown): void {
    this.completeWithWarning(this.fallbackSummary(), error)
  }

  fail(error: unknown): void {
    if (this.options.state.executionOutcome.status === 'sealed_success') {
      this.completeWithFallback(error)
      return
    }
    const serialized = serializeError(error)
    this.options.state.executionOutcome = {
      ...this.options.state.executionOutcome,
      status: 'failed',
      verificationSummary: this.options.state.executionOutcome.facts
        ? this.options.state.executionOutcome.verificationSummary
        : { summary: serialized.message, evidence: this.options.state.executionOutcome.verificationSummary.evidence },
    }
    this.options.state.error = serialized
    this.transition('failed', serialized.code)
    this.emit({ type: 'RunFailed', error: serialized, usage: this.options.budget.snapshot() })
    logger.error('Agent 运行失败', {
      event: 'agent_runtime.run.failed',
      requestId: this.options.runId,
      context: {
        errorCode: serialized.code,
        turns: this.options.budget.snapshot().turns,
      },
    })
    this.finishTerminal()
  }

  /**
   * 最终说明生成失败时的兜底文案。
   *
   * 只能由**已经发生的事实**拼成：封存时记下的验证摘要，以及 Effect 里真实出现过的实体类型。
   * 旧实现读的是任务图里 status 为 completed 的 Facet goal——那是运行前的计划文本，说的是
   * "本来打算做什么"，而这条消息出现的场合恰恰是"事情做完了但话没说出来"。
   */
  private fallbackSummary(): string {
    const outcome = this.options.state.executionOutcome
    const recorded = outcome.verificationSummary.summary || '请检查当前应用中的实际结果。'
    return `已保留本次实际发生的操作记录。${recorded} 最终说明生成失败，请根据以上结果与未完成事项继续处理。`
  }

  exhaustBudget(code: string, error: unknown): void {
    if (this.options.state.executionOutcome.status === 'sealed_success') {
      this.completeWithFallback(error)
      return
    }
    const serialized = serializeError(error)
    this.options.state.error = serialized
    this.emit({ type: 'BudgetHardLimitReached', code, usage: this.options.budget.snapshot() })
    this.transition('budget_exhausted', code)
    logger.warn('Agent 单段运行预算耗尽', {
      event: 'agent_runtime.run.budget_exhausted',
      requestId: this.options.runId,
      context: {
        code,
        turns: this.options.budget.snapshot().turns,
        toolCalls: this.options.budget.snapshot().toolCalls,
        writeToolCalls: this.options.budget.snapshot().writeToolCalls,
      },
    })
    this.finishTerminal()
  }

  finishTerminal(): void {
    this.options.dependencies.onTerminal?.(this.getState())
  }

  private recordEmittedEvent(event: AgentEvent): void {
    const { state, dependencies } = this.options
    state.sequence = event.sequence
    state.workingSummary = reduceAgentWorkingSummary(
      state.workingSummary,
      event,
      state.lastScopeRevisions
    )
    this.refreshState()
    dependencies.onEvent?.(event)
    dependencies.onCheckpoint?.(this.getState())
  }

  private refreshState(): void {
    this.options.state.status = this.options.machine.status
    this.options.state.usage = this.options.budget.snapshot()
    this.options.state.updatedAt = new Date().toISOString()
  }
}
