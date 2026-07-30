interface PendingClarification {
  waitId: string
  resolve: (content: string) => void
}

export class AgentClarificationWaiter {
  private pending: PendingClarification | null = null

  wait(waitId: string): Promise<string> {
    if (this.pending) throw new Error('[CLARIFICATION_ALREADY_WAITING] 已有待回答的澄清问题')
    return new Promise((resolve) => {
      this.pending = { waitId, resolve }
    })
  }

  matches(waitId: string): boolean {
    return this.pending?.waitId === waitId
  }

  settle(waitId: string, content: string): boolean {
    if (!this.pending || this.pending.waitId !== waitId) return false
    const pending = this.pending
    this.pending = null
    pending.resolve(content)
    return true
  }

  cancel(): void {
    if (!this.pending) return
    const pending = this.pending
    this.pending = null
    pending.resolve('')
  }
}
