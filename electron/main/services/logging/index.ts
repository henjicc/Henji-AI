import { getDb } from '../db'
import { AgentTraceStore, createAgentTraceStore } from './agent-trace-store'

export type { LogEventBridgeDto } from './types'
export { appendLogEvents } from './push'
export { createMainLogger } from './main-logger'
export type { MainLogger } from './main-logger'
export { runLogRetention } from './retention'
export { sanitizeJsonValue } from './sanitize'
export { getLogCaptureMode, setLogCaptureMode } from './capture-config'
export type { LogCaptureMode } from './capture-config'
export { getAgentTraceCaptureMode, setAgentTraceCaptureMode } from './agent-trace-config'
export { listLogDates, queryLogEvents } from './query'
export type { LogQueryParams, LogQueryResult } from './query'
export { exportImageEditorDiagnosticBundle } from './diagnostic-bundle'
export { AgentTraceStore }

let agentTraceStore: AgentTraceStore | null = null

export function getAgentTraceStore(): AgentTraceStore {
  agentTraceStore ??= createAgentTraceStore(getDb())
  return agentTraceStore
}
