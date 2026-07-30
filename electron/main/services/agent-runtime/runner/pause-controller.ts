import type { AgentRunStatus } from '../../../../../src/core/assistant/events'
import { isTerminalAgentState } from './state-machine'

interface AgentPauseControllerOptions {
  getStatus: () => AgentRunStatus
  transition: (status: AgentRunStatus, reason?: string) => void
  setCurrentToolCallId: (toolCallId: string | null) => void
  clearWaitingApprovalId: () => void
}

export class AgentPauseController {
  private pausedFrom: Exclude<AgentRunStatus, 'paused'> = 'running'
  private waiters: Array<() => void> = []

  constructor(private readonly options: AgentPauseControllerOptions) {}

  pause(reason: string): void {
    const status = this.options.getStatus()
    if (isTerminalAgentState(status) || status === 'paused') return
    if (status === 'initializing') throw new Error('Agent 尚未进入可暂停状态')
    this.pausedFrom = status
    this.options.transition('paused', reason)
  }

  resume(): void {
    if (this.options.getStatus() !== 'paused') return
    this.options.transition(this.pausedFrom, '用户恢复')
    this.wake()
  }

  async wait(): Promise<void> {
    while (this.options.getStatus() === 'paused') {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }

  setActiveToolCall(toolCallId: string | null): void {
    this.options.setCurrentToolCallId(toolCallId)
    if (toolCallId) {
      this.options.transition('waiting_tool')
      return
    }
    this.options.clearWaitingApprovalId()
    const status = this.options.getStatus()
    if (status === 'waiting_tool' || status === 'waiting_approval') {
      this.options.transition('running')
    } else if (status === 'paused') {
      this.pausedFrom = 'running'
    }
  }

  setPausedFrom(status: Exclude<AgentRunStatus, 'paused'>): void {
    this.pausedFrom = status
  }

  wake(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const resolve of waiters) resolve()
  }
}
