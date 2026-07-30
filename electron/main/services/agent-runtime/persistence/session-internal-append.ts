import {
  agentSessionInternalAppendSchema,
  type AgentSessionEntry,
} from '../../../../../src/core/assistant/session'
import type { AgentPersistenceStore } from './store'

interface SessionInternalRunRecord {
  threadId: string
}

export function appendValidatedSessionInternal(
  payload: unknown,
  findRun: (runId: string) => SessionInternalRunRecord | undefined,
  persistence: AgentPersistenceStore
): AgentSessionEntry {
  const input = agentSessionInternalAppendSchema.parse(payload)
  const record = findRun(input.runId)
  if (!record || record.threadId !== input.threadId) {
    throw new Error('[PERMISSION_DENIED] 内部会话条目不属于当前 run/thread')
  }
  return persistence.appendSessionInternal(input)
}
