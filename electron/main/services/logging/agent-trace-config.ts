import type { AgentTraceCaptureMode } from '../../../../src/core/assistant/trace'
import { createMainLogger } from './main-logger'

let captureMode: AgentTraceCaptureMode = 'summary'
const logger = createMainLogger('main.agent_trace')

export function getAgentTraceCaptureMode(): AgentTraceCaptureMode {
  return captureMode
}

export function setAgentTraceCaptureMode(mode: AgentTraceCaptureMode): void {
  captureMode = mode === 'detailed' ? 'detailed' : 'summary'
  logger.info('助手追踪捕获模式已更新', {
    event: 'agent_trace.capture_mode.updated',
    context: { mode: captureMode },
  })
}
