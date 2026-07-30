import type { AgentRunState } from '../../../../src/core/assistant/events'
import { createMainLogger } from '../logging'
import type { AgentPersistenceStore } from './persistence/store'

const logger = createMainLogger('main.agent_runtime')

interface RuntimeSettlementRecord {
  threadId: string
}

interface SettleRuntimeRunInput<TRecord extends RuntimeSettlementRecord, TListeners> {
  runId: string
  state: AgentRunState
  record?: TRecord
  persistence: AgentPersistenceStore
  activeByThread: Map<string, string>
  eventListeners: Map<string, TListeners>
  runs: Map<string, TRecord>
}

export function settleRuntimeRun<TRecord extends RuntimeSettlementRecord, TListeners>(
  input: SettleRuntimeRunInput<TRecord, TListeners>
): void {
  input.persistence.saveState(input.state)
  input.persistence.appendTerminalMessage(input.state)
  input.persistence.appendSettledSavePoint(input.state)
  if (input.record && input.activeByThread.get(input.record.threadId) === input.runId) {
    input.activeByThread.delete(input.record.threadId)
  }
  input.eventListeners.delete(input.runId)
  input.runs.delete(input.runId)
  logger.info('Agent 终局持久化完成并释放运行资源', {
    event: 'agent_runtime.run.settled',
    requestId: input.runId,
  })
}
