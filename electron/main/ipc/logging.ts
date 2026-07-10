import { appendLogEvents, getLogCaptureMode, setLogCaptureMode, type LogCaptureMode, type LogEventBridgeDto } from '../services/logging'
import { openLogWindow } from '../windows/log-window'
import { parseRecord, parseVoid, registerIpcHandler } from './registry'

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
  registerIpcHandler<void, LogCaptureMode>('logging:getCaptureConfig', parseVoid, () => getLogCaptureMode())
  // 打开独立日志窗口：不做打包态/测试模式主进程侧门控，入口可见性与快捷键注册完全由渲染层决定
  // （与既有 F12 DevTools 切换 IPC 同款模式：主进程始终暴露能力，渲染层负责判断"是否该调用"）。
  registerIpcHandler<void, void>('logging:openWindow', parseVoid, () => openLogWindow())
}
