import type { LogEventBridgeDto } from '@/core/logging/types'

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

export interface LoggingPlatform {
  logFrontendEvents(events: LogEventBridgeDto[]): Promise<void>
  listenLogEvent(handler: (events: LogEventPushDto[]) => void): Promise<() => void>
  setCaptureConfig(mode: LogCaptureMode): Promise<void>
  getCaptureConfig(): Promise<LogCaptureMode>
  /** 打开（或聚焦已存在的）独立日志窗口（2.1 日志窗口骨架）。 */
  openLogWindow(): Promise<void>
}
