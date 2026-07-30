import { agentSessionCompactionAppendSchema } from '../../../../../src/core/assistant/session'
import type { AgentPersistenceStore } from './store'

interface SessionCompactionRunRecord {
  threadId: string
}

export function appendValidatedSessionCompaction(
  payload: unknown,
  findRun: (runId: string) => SessionCompactionRunRecord | undefined,
  persistence: AgentPersistenceStore
): { saved: true } {
  const input = agentSessionCompactionAppendSchema.parse(payload)
  const record = findRun(input.runId)
  if (!record || record.threadId !== input.threadId) {
    throw new Error('[PERMISSION_DENIED] 压缩条目不属于当前 run/thread')
  }
  persistence.appendSessionCompaction(input)
  return { saved: true }
}
