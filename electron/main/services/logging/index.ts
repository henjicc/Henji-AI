import { getDb } from '../db'
import { AgentTraceStore, createAgentTraceStore } from './agent-trace-store'

export type { LogEventBridgeDto, MainLogEvent, MainLogLevel, MainLogSource } from './types'
export { MAIN_LOG_FILE_PREFIX, MAIN_LOG_MAX_TOTAL_BYTES, MAIN_LOG_RETENTION_DAYS } from './types'
export { appendLogEvents, LOG_EVENT_CHANNEL, pushLogEvents } from './push'
export { createMainLogger } from './main-logger'
export type { MainLogger, MainLoggerMeta } from './main-logger'
export { runLogRetention } from './retention'
export { isSensitiveKey, MAIN_LOG_EVENT_MAX_BYTES, sanitizeJsonValue } from './sanitize'
export { getLogCaptureMode, setLogCaptureMode } from './capture-config'
export type { LogCaptureMode } from './capture-config'
export { getAgentTraceCaptureMode, setAgentTraceCaptureMode } from './agent-trace-config'
export { listLogDates, queryLogEvents } from './query'
export type { LogQueryParams, LogQueryResult } from './query'
export { AgentTraceStore, createAgentTraceStore }
export type {
  AgentTraceCompleteInput,
  AgentTraceDetailResult,
  AgentTraceFailInput,
  AgentTraceQuery,
  AgentTraceQueryResult,
  AgentTraceStartInput,
} from '../../../../src/core/assistant/trace'

let agentTraceStore: AgentTraceStore | null = null

export function getAgentTraceStore(): AgentTraceStore {
  agentTraceStore ??= createAgentTraceStore(getDb())
  return agentTraceStore
}
