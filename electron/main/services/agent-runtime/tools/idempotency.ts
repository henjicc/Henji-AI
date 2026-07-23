import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'

type LedgerStatus = 'executing' | 'succeeded' | 'failed' | 'unknown'

interface LedgerEntry {
  inputDigest: string
  status: LedgerStatus
  observation?: AgentToolObservation
}

export type IdempotencyBeginResult =
  | { status: 'started' }
  | { status: 'cached'; observation: AgentToolObservation }

export class AgentIdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentIdempotencyConflictError'
  }
}

export class AgentIdempotencyLedger {
  private readonly entries = new Map<string, LedgerEntry>()

  lookup(key: string, inputDigest: string): IdempotencyBeginResult | null {
    const current = this.entries.get(key)
    if (!current) return null
    if (current.inputDigest !== inputDigest) {
      throw new AgentIdempotencyConflictError('相同工具调用 ID 的参数摘要不一致')
    }
    if (current.status === 'succeeded' && current.observation) {
      return { status: 'cached', observation: current.observation }
    }
    if (current.status === 'unknown') {
      throw new AgentIdempotencyConflictError('工具调用副作用状态未知，禁止自动重放')
    }
    throw new AgentIdempotencyConflictError(`工具调用当前状态为 ${current.status}，禁止重复执行`)
  }

  begin(key: string, inputDigest: string): IdempotencyBeginResult {
    const existing = this.lookup(key, inputDigest)
    if (existing) return existing
    this.entries.set(key, { inputDigest, status: 'executing' })
    return { status: 'started' }
  }

  succeed(key: string, observation: AgentToolObservation): void {
    const current = this.entries.get(key)
    if (!current) return
    current.status = 'succeeded'
    current.observation = observation
  }

  fail(key: string): void {
    const current = this.entries.get(key)
    if (current) current.status = 'failed'
  }

  markUnknown(key: string): void {
    const current = this.entries.get(key)
    if (current) current.status = 'unknown'
  }
}
