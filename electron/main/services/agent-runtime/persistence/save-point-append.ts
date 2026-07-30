import { agentSavePointAppendSchema } from '../../../../../src/core/assistant/turn'
import type { AgentPersistenceStore } from './store'

export function appendValidatedSavePoint(
  payload: unknown,
  findThreadId: (runId: string) => string | undefined,
  persistence: AgentPersistenceStore
): unknown {
  const input = agentSavePointAppendSchema.parse(payload)
  if (findThreadId(input.state.runId) !== input.state.threadId) {
    throw new Error('[PERMISSION_DENIED] 保存点不属于当前 run/thread')
  }
  return persistence.appendSavePoint(input)
}
