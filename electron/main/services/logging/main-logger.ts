import { appendLogEvents } from './push'
import type { MainLogEvent, MainLogLevel } from './types'
import { AGENT_UTILITY_PROTOCOL_VERSION } from '../../../../src/core/assistant/utilityContracts'

/**
 * 主进程侧 logger 调用参数，接口对齐渲染层 `src/core/logging/logger.ts` 的
 * `createLogger` 元信息形状（`LogCallMeta` 的主进程子集）。
 */
export interface MainLoggerMeta {
  event?: string
  requestId?: string
  taskId?: string
  modelId?: string
  providerId?: string
  context?: unknown
  error?: unknown
}

export interface MainLogger {
  trace: (message: string, meta?: MainLoggerMeta) => void
  debug: (message: string, meta?: MainLoggerMeta) => void
  info: (message: string, meta?: MainLoggerMeta) => void
  warn: (message: string, meta?: MainLoggerMeta) => void
  error: (message: string, meta?: MainLoggerMeta) => void
}

function inferEvent(message: string, level: MainLogLevel): string {
  const trimmed = message.trim().toLowerCase()
  if (!trimmed) {
    return `${level}.event`
  }

  const compact = trimmed.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return compact ? compact.slice(0, 64) : `${level}.event`
}

export function serializeMainLogError(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (value instanceof Error) {
    const errorRecord = value as Error & { code?: unknown; cause?: unknown }
    const enumerable = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeMainLogError(item, seen)])
    )
    return {
      ...enumerable,
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(errorRecord.code !== undefined ? { code: serializeMainLogError(errorRecord.code, seen) } : {}),
      ...(errorRecord.cause !== undefined ? { cause: serializeMainLogError(errorRecord.cause, seen) } : {}),
    }
  }
  if (Array.isArray(value)) return value.map((item) => serializeMainLogError(item, seen))
  if (value instanceof Date) return value.toISOString()
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, serializeMainLogError(item, seen)])
  )
}

function logAt(domain: string, level: MainLogLevel, message: string, meta: MainLoggerMeta): void {
  const event: MainLogEvent = {
    timestamp: new Date().toISOString(),
    level,
    domain,
    event: meta.event || inferEvent(message, level),
    message,
    requestId: meta.requestId,
    taskId: meta.taskId,
    modelId: meta.modelId,
    providerId: meta.providerId,
    context: meta.context,
    error: meta.error === undefined ? undefined : serializeMainLogError(meta.error),
    source: 'backend',
  }

  if (process.parentPort) {
    process.parentPort.postMessage({
      type: 'utility.log',
      protocolVersion: AGENT_UTILITY_PROTOCOL_VERSION,
      event,
    })
    return
  }

  // 主进程日志属于诊断信息，写入失败不应影响调用方的主业务流程，此处静默吞掉。
  void appendLogEvents([event]).catch(() => undefined)
}

export function createMainLogger(domain: string): MainLogger {
  const normalizedDomain = domain.trim() || 'main'

  return {
    trace: (message, meta = {}) => logAt(normalizedDomain, 'trace', message, meta),
    debug: (message, meta = {}) => logAt(normalizedDomain, 'debug', message, meta),
    info: (message, meta = {}) => logAt(normalizedDomain, 'info', message, meta),
    warn: (message, meta = {}) => logAt(normalizedDomain, 'warn', message, meta),
    error: (message, meta = {}) => logAt(normalizedDomain, 'error', message, meta),
  }
}
