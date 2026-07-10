import { appendLogEvents, setLogCaptureMode, type LogCaptureMode, type LogEventBridgeDto } from '../services/logging'
import { parseRecord, registerIpcHandler } from './registry'

interface LogEventsPayload {
  events: LogEventBridgeDto[]
}

interface SetCaptureConfigPayload {
  mode: LogCaptureMode
}

const LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error'])

function isLogEvent(value: unknown): value is LogEventBridgeDto {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.timestamp === 'string' &&
    typeof record.level === 'string' &&
    LOG_LEVELS.has(record.level) &&
    typeof record.domain === 'string' &&
    typeof record.event === 'string' &&
    typeof record.message === 'string'
  )
}

function parseLogEventsPayload(input: unknown): LogEventsPayload {
  const record = parseRecord(input)
  const events = record.events
  if (!Array.isArray(events) || !events.every(isLogEvent)) {
    throw new Error('Expected log events array')
  }
  return { events }
}

function parseCaptureConfigPayload(input: unknown): SetCaptureConfigPayload {
  const record = parseRecord(input)
  const mode = record.mode
  if (mode !== 'standard' && mode !== 'full') {
    throw new Error('Expected capture mode to be "standard" or "full"')
  }
  return { mode }
}

export function registerLoggingIpc(): void {
  registerIpcHandler<LogEventsPayload, void>('logging:frontendEvents', parseLogEventsPayload, ({ events }) =>
    appendLogEvents(events.map((event) => ({ ...event, source: 'frontend' as const })))
  )
  registerIpcHandler<SetCaptureConfigPayload, void>('logging:setCaptureConfig', parseCaptureConfigPayload, ({ mode }) =>
    setLogCaptureMode(mode)
  )
}
