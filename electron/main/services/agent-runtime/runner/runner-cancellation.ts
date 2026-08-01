import type { AgentEventInput, AgentRunState } from '../../../../../src/core/assistant/events'
import { createMainLogger } from '../../logging'
import type { AgentRunMetrics } from './budget'

const logger = createMainLogger('main.agent_runtime')

interface CancelAgentRunInput {
  runId: string
  reason: string
  abort: (reason: string) => void
  currentModelRequestId: string | null
  cancelModelStep: (requestId: string) => void
  startApprovalCleanup: () => void
  cancelApproval: () => void
  cancelClarification: () => void
  wakePause: () => void
  transitionCancelled: (reason: string) => void
  emit: (event: AgentEventInput) => void
  budget: AgentRunMetrics
  waitApprovalCleanup: () => Promise<void>
  flushConversation: () => Promise<void>
  finishTerminal: () => void
  getState: () => AgentRunState
}

export function cancelAgentRun(input: CancelAgentRunInput): AgentRunState {
  input.abort(input.reason)
  if (input.currentModelRequestId) input.cancelModelStep(input.currentModelRequestId)
  input.startApprovalCleanup()
  input.cancelApproval()
  input.cancelClarification()
  input.wakePause()
  input.transitionCancelled(input.reason)
  input.emit({ type: 'RunCancelled', reason: input.reason, usage: input.budget.snapshot() })
  logger.info('Agent 运行已取消', {
    event: 'agent_runtime.run.cancelled', requestId: input.runId, context: { reason: input.reason },
  })
  void Promise.all([input.waitApprovalCleanup(), input.flushConversation()]).then(() => {
    input.finishTerminal()
  }).catch((error: unknown) => {
    logger.error('取消运行时刷新会话消息失败', {
      event: 'agent_runtime.session.cancel_flush.failed',
      requestId: input.runId,
      error,
    })
    input.finishTerminal()
  })
  return input.getState()
}
