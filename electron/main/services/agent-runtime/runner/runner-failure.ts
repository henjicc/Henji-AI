import { createMainLogger } from '../../logging'
import { errorCode } from './runner-results'

const logger = createMainLogger('main.agent_runtime')

export function handleAsyncAgentFailure(input: {
  runId: string
  error: unknown
  currentError: unknown | null
  terminal: boolean
  currentModelRequestId: string | null
  cancelModelStep: (requestId: string) => void
  abort: (error: unknown) => void
  cancelApproval: () => void
  wakePause: () => void
}): unknown | null {
  if (input.currentError || input.terminal) return input.currentError
  logger.error('Agent 异步事件刷新失败，正在受控终止运行', {
    event: 'agent_runtime.event_flush.failed',
    requestId: input.runId,
    context: { errorCode: errorCode(input.error) },
  })
  if (input.currentModelRequestId) {
    try {
      input.cancelModelStep(input.currentModelRequestId)
    } catch {
      // 后续 abort 与 Runner 终局仍会继续，取消回调不能阻断错误收口。
    }
  }
  input.abort(input.error)
  input.cancelApproval()
  input.wakePause()
  return input.error
}

export function settleAgentClarification(input: {
  waitId: string
  content: string
  settle: (waitId: string, content: string) => boolean
  clearWaitingId: () => void
  status: string
  transitionRunning: () => void
  setPausedFromRunning: () => void
}): void {
  const content = input.content.trim()
  if (!content) throw new Error('[CLARIFICATION_EMPTY] 澄清回答不能为空')
  if (!input.settle(input.waitId, content)) {
    throw new Error('[CLARIFICATION_NOT_WAITING] 回答不属于当前等待中的问题')
  }
  input.clearWaitingId()
  if (input.status === 'waiting_user') input.transitionRunning()
  else if (input.status === 'paused') input.setPausedFromRunning()
}
