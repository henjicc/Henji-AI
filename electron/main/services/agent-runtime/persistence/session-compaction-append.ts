import {
  agentSessionCompactionAppendSchema,
  type AgentSessionEntry,
} from '../../../../../src/core/assistant/session'
import type { AgentPersistenceStore } from './store'

interface SessionCompactionRunRecord {
  threadId: string
}

export function appendValidatedSessionCompaction(
  payload: unknown,
  findRun: (runId: string) => SessionCompactionRunRecord | undefined,
  persistence: AgentPersistenceStore
): AgentSessionEntry {
  const input = agentSessionCompactionAppendSchema.parse(payload)
  const record = findRun(input.runId)
  if (!record || record.threadId !== input.threadId) {
    throw new Error('[PERMISSION_DENIED] 压缩条目不属于当前 run/thread')
  }
  return persistence.appendSessionCompaction(input)
}
