/**
 * 主进程日志事件类型。
 *
 * 与渲染层 `src/core/logging/types.ts` 的 `LogEvent` 字段对齐，但不含渲染层专用的
 * 本地展示 `id` 字段——主进程侧事件只在落盘/推送时使用，不需要本地列表去重 id。
 */

export type MainLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export type MainLogSource = 'frontend' | 'backend'

export interface MainLogEvent {
  timestamp: string
  level: MainLogLevel
  domain: string
  event: string
  message: string
  requestId?: string
  taskId?: string
  modelId?: string
  providerId?: string
  context?: unknown
  error?: unknown
  source: MainLogSource
}

/**
 * 前端桥接过来的日志事件载荷，对齐渲染层 `src/core/logging/types.ts` 的
 * `LogEventBridgeDto`（不含 `source`，由主进程写入时统一补充为 `'frontend'`）。
 */
export interface LogEventBridgeDto {
  timestamp: string
  level: MainLogLevel
  domain: string
  event: string
  message: string
  requestId?: string
  taskId?: string
  modelId?: string
  providerId?: string
  context?: unknown
  error?: unknown
}

/**
 * 新日志文件名前缀。写入（writer.ts 拼文件名）与清理（retention.ts 扫描目录）
 * 共用同一个常量，避免两处各写一份字符串而产生不一致——旧的 `frontend-*.log`
 * 不带这个前缀，不会被扫描到，天然不迁移不删除、自然过期。
 */
export const MAIN_LOG_FILE_PREFIX = 'henji-'

/** 日志文件保留时限（天）：早于此时限的 `henji-*.log` 文件在启动清理时删除。 */
export const MAIN_LOG_RETENTION_DAYS = 1

/** 日志目录总大小上限（字节），默认 256MB，超限时从最旧文件开始删除。 */
export const MAIN_LOG_MAX_TOTAL_BYTES = 256 * 1024 * 1024
