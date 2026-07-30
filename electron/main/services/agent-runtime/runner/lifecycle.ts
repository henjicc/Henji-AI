import { createMainLogger } from '../../logging'
import {
  agentRunStateSchema,
  type AgentEvent,
  type AgentEventInput,
  type AgentRunState,
  type AgentRunStatus,
} from '../../../../../src/core/assistant/events'
import type { AgentRunnerDependencies } from './types'
import type { AgentBudgetTracker } from './budget'
import { AgentEventStream } from './event-stream'
import { serializeError } from './runner-results'
import type { AgentStateMachine } from './state-machine'
import { reduceAgentWorkingSummary } from './working-summary'

const logger = createMainLogger('main.agent_runtime')

interface AgentRunnerLifecycleOptions {
  runId: string
  state: AgentRunState
  machine: AgentStateMachine
  budget: AgentBudgetTracker
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

  fail(error: unknown): void {
    const serialized = serializeError(error)
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
