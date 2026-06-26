import { appendFrontendLogEvents, type LogEventBridgeDto } from '../services/logging'
import { parseRecord, registerIpcHandler } from './registry'

interface LogEventsPayload {
  events: LogEventBridgeDto[]
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

export function registerLoggingIpc(): void {
  registerIpcHandler<LogEventsPayload, void>('logging:frontendEvents', parseLogEventsPayload, ({ events }) => appendFrontendLogEvents(events))
}
