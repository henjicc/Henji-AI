import { logApprovalRunExpiryFailure } from './approval-logging'

export class AgentTerminalApprovalCleanup {
  private pending: Promise<void> | null = null

  constructor(
    private readonly runId: string,
    private readonly expireRunApprovals: () => Promise<void>
  ) {}

  start(): void {
    this.pending ??= this.expireRunApprovals()
      .catch((error) => logApprovalRunExpiryFailure(this.runId, error))
  }

  wait(): Promise<void> {
    return this.pending ?? Promise.resolve()
  }

  async run(): Promise<void> {
    this.start()
    await this.wait()
  }
}
