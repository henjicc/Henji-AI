import type {
  AgentApprovalRequest,
  AgentEventInput,
  AgentRunState,
  AgentRunStatus,
} from '../../../../../src/core/assistant/events'
import type { ModelStepToolCall } from '@henjicc/ai-sdk'
import type { AgentToolGateway } from '../tools/gateway'
import { AgentApprovalWaiter } from './approval-waiter'
import { logApprovalExpired, logApprovalRequested, logApprovalResolved } from './approval-logging'

interface AgentApprovalCoordinatorOptions {
  runId: string
  gateway: AgentToolGateway
  getStatus: () => AgentRunStatus
  getCurrentToolCallId: () => string | null
  setCurrentToolCallId: (toolCallId: string) => void
  setWaitingApprovalId: (approvalId: string | null) => void
  transition: (status: AgentRunStatus, reason?: string) => void
  setPausedFrom: (status: Exclude<AgentRunStatus, 'paused'>) => void
  emit: (event: AgentEventInput) => void
  onAsyncError: (error: unknown) => void
  onPhase?: (phase: 'awaiting_approval' | 'executing') => void
}

export class AgentApprovalCoordinator {
  private readonly waiter = new AgentApprovalWaiter()

  constructor(private readonly options: AgentApprovalCoordinatorOptions) {}

  request(call: ModelStepToolCall, approval: AgentApprovalRequest): Promise<'approve' | 'reject' | 'expired'> {
    this.options.setCurrentToolCallId(call.toolCallId)
    this.options.setWaitingApprovalId(approval.approvalId)
    this.options.transition('waiting_approval')
    this.options.onPhase?.('awaiting_approval')
    const decision = this.waiter.wait({
      approvalId: approval.approvalId,
      expiresAt: approval.expiresAt,
      onExpired: () => this.handleExpired(approval.approvalId),
    })
    this.options.emit({ type: 'ApprovalRequired', toolCallId: call.toolCallId, approval })
    logApprovalRequested(this.options.runId, call.toolCallId, call.toolName, approval)
    return decision
  }

  async respond(
    approvalId: string,
    decision: 'approve' | 'reject'
  ): Promise<AgentRunState | null> {
    if (!this.waiter.matches(approvalId)) throw new Error('审批不属于当前等待中的工具调用')
    if (!this.waiter.claim(approvalId)) throw new Error('审批正在由另一个决策或过期流程处理')
    try {
      const resolved = await this.options.gateway.resolveApproval(
        approvalId, this.options.runId, decision
      )
      const toolCallId = this.options.getCurrentToolCallId()
      if (!toolCallId) throw new Error('审批缺少关联工具调用')
      this.options.emit({ type: 'ApprovalResolved', toolCallId, approvalId, decision: resolved })
      logApprovalResolved(this.options.runId, toolCallId, approvalId, resolved)
      this.options.setWaitingApprovalId(null)
      if (this.options.getStatus() === 'waiting_approval') this.options.transition('waiting_tool')
      else if (this.options.getStatus() === 'paused') this.options.setPausedFrom('waiting_tool')
      this.waiter.settle(decision)
      this.options.onPhase?.('executing')
      return null
    } catch (error) {
      this.waiter.release(approvalId)
      throw error
    }
  }

  cancel(): void {
    this.waiter.settle('reject')
  }

  private async handleExpired(approvalId: string): Promise<void> {
    try {
      await this.options.gateway.expireApproval(approvalId, this.options.runId)
    } catch (error) {
      this.options.onAsyncError(error)
    }
    if (!this.waiter.matches(approvalId)) return
    const toolCallId = this.options.getCurrentToolCallId()
    if (toolCallId) {
      this.options.emit({ type: 'ApprovalResolved', toolCallId, approvalId, decision: 'expired' })
    }
    logApprovalExpired(this.options.runId, toolCallId, approvalId)
    this.options.setWaitingApprovalId(null)
    if (this.options.getStatus() === 'waiting_approval') {
      this.options.transition('waiting_tool', '审批已过期')
    } else if (this.options.getStatus() === 'paused') {
      this.options.setPausedFrom('waiting_tool')
    }
    this.options.onPhase?.('executing')
  }
}
