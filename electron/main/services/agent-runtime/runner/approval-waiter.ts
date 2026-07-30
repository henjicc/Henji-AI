export type AgentApprovalDecision = 'approve' | 'reject' | 'expired'

interface ActiveApprovalWait {
  approvalId: string
  expiresAt: string
  onExpired: () => Promise<void> | void
  timer: ReturnType<typeof setTimeout> | null
  resolving: boolean
  resolve: (decision: AgentApprovalDecision) => void
}

interface AgentApprovalWaitOptions {
  approvalId: string
  expiresAt: string
  onExpired: () => Promise<void> | void
}

export class AgentApprovalWaiter {
  private active: ActiveApprovalWait | null = null

  matches(approvalId: string): boolean {
    return this.active?.approvalId === approvalId
  }

  wait(options: AgentApprovalWaitOptions): Promise<AgentApprovalDecision> {
    if (this.active) throw new Error('已有工具审批正在等待处理')
    return new Promise((resolve) => {
      const active: ActiveApprovalWait = {
        approvalId: options.approvalId,
        expiresAt: options.expiresAt,
        onExpired: options.onExpired,
        timer: null,
        resolving: false,
        resolve,
      }
      this.active = active
      this.armExpiry(active)
    })
  }

  claim(approvalId: string): boolean {
    const active = this.active
    if (!active || active.approvalId !== approvalId || active.resolving) return false
    active.resolving = true
    if (active.timer) clearTimeout(active.timer)
    active.timer = null
    return true
  }

  release(approvalId: string): void {
    const active = this.active
    if (!active || active.approvalId !== approvalId || !active.resolving) return
    active.resolving = false
    this.armExpiry(active)
  }

  settle(decision: AgentApprovalDecision): void {
    const active = this.active
    if (!active) return
    this.active = null
    if (active.timer) clearTimeout(active.timer)
    active.resolve(decision)
  }

  private armExpiry(active: ActiveApprovalWait): void {
    const delay = Math.max(0, Date.parse(active.expiresAt) - Date.now())
    active.timer = setTimeout(() => {
      if (this.active !== active || active.resolving) return
      active.resolving = true
      active.timer = null
      void Promise.resolve()
        .then(active.onExpired)
        .finally(() => this.settle('expired'))
        .catch(() => undefined)
    }, delay)
  }
}
