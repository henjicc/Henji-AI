import type { LogEventBridgeDto } from '@/core/logging/types'
import type {
  AgentTraceCaptureMode,
  AgentTraceDetailResult,
  AgentTraceQuery,
  AgentTraceQueryResult,
} from '@/core/assistant/trace'

/**
 * 主进程实时推送的日志事件（含 `source`），与 `LogEventBridgeDto` 的区别是
 * 多了 `source: 'frontend' | 'backend'`，用于区分事件来自渲染层还是主进程自身。
 */
export interface LogEventPushDto extends LogEventBridgeDto {
  source: 'frontend' | 'backend'
  /** 单条事件体积保险丝命中时为 true，此时 context/error 已被主进程强制丢弃，见 `MainLogEvent`。 */
  truncatedByLimit?: boolean
}

/** 日志捕获模式：standard 沿用截断策略节省体积；full 长文本/图片 base64 不截断。 */
export type LogCaptureMode = 'standard' | 'full'

/** 历史日志查询参数（2.3 历史日志回读），语义与主进程 `query.ts` 的 `LogQueryParams` 一致。 */
export interface LogQueryParams {
  date: string
  level?: LogEventPushDto['level']
  source?: LogEventPushDto['source']
  domainPrefix?: string
  requestId?: string
  keyword?: string
  beforeTimestamp?: string
  /** 只返回时间戳大于等于该值的事件，适合按一次测试/操作的起点截取证据。 */
  afterTimestamp?: string
  beforeLine?: number
  limit?: number
}

export interface LogQueryResult {
  /** 命中事件，按时间戳降序排列（最新在前）。 */
  events: LogEventPushDto[]
  hasMore: boolean
  corruptedLines: number
  nextBeforeLine?: number
}

export interface LoggingPlatform {
  logFrontendEvents(events: LogEventBridgeDto[]): Promise<void>
  listenLogEvent(handler: (events: LogEventPushDto[]) => void): Promise<() => void>
  setCaptureConfig(mode: LogCaptureMode): Promise<void>
  getCaptureConfig(): Promise<LogCaptureMode>
  /** 打开（或聚焦已存在的）独立日志窗口（2.1 日志窗口骨架）。 */
  openLogWindow(): Promise<void>
  /** 列出当前存在的日志文件对应的日期（降序），供历史模式日期选择器使用。 */
  listLogDates(): Promise<string[]>
  /** 按日期流式查询历史日志事件，过滤/分页均在主进程完成。 */
  queryLogEvents(params: LogQueryParams): Promise<LogQueryResult>
  getAgentTraceCaptureMode(): Promise<AgentTraceCaptureMode>
  setAgentTraceCaptureMode(mode: AgentTraceCaptureMode): Promise<void>
  queryAgentTraces(params: AgentTraceQuery): Promise<AgentTraceQueryResult>
  getAgentTraceDetail(traceId: string): Promise<AgentTraceDetailResult | null>
  clearAgentTraces(date?: string): Promise<void>
}
