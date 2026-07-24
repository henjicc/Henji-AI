export type AgentApprovalDecision = 'approve' | 'reject' | 'expired'

interface ActiveApprovalWait {
  approvalId: string
  timer: ReturnType<typeof setTimeout>
  resolve: (decision: AgentApprovalDecision) => void
}

interface AgentApprovalWaitOptions {
  approvalId: string
  expiresAt: string
  onExpired: () => void
}

export class AgentApprovalWaiter {
  private active: ActiveApprovalWait | null = null

  matches(approvalId: string): boolean {
    return this.active?.approvalId === approvalId
  }

  wait(options: AgentApprovalWaitOptions): Promise<AgentApprovalDecision> {
    if (this.active) throw new Error('已有工具审批正在等待处理')
    return new Promise((resolve) => {
      const delay = Math.max(0, Date.parse(options.expiresAt) - Date.now())
      const timer = setTimeout(() => {
        if (!this.matches(options.approvalId)) return
        try {
          options.onExpired()
        } finally {
          this.settle('expired')
        }
      }, delay)
      this.active = { approvalId: options.approvalId, timer, resolve }
    })
  }

  settle(decision: AgentApprovalDecision): void {
    const active = this.active
    if (!active) return
    this.active = null
    clearTimeout(active.timer)
    active.resolve(decision)
  }
}
