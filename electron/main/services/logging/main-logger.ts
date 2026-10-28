import { appendLogEvents } from './push'
import type { MainLogEvent, MainLogLevel } from './types'

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

function logAt(domain: string, level: MainLogLevel, message: string, meta: MainLoggerMeta): void {
  const event: MainLogEvent = {
    timestamp: new Date().toISOString(),
    level,
    domain,
    event: meta.event || '',
    message,
    requestId: meta.requestId,
    taskId: meta.taskId,
    modelId: meta.modelId,
    providerId: meta.providerId,
    context: meta.context,
    error: meta.error,
    source: 'backend',
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
