import type { LogEventBridgeDto } from '@/core/logging/types'
import type { LogCaptureMode, LogEventPushDto } from '@/platform/contracts/logging'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'

export type { LogCaptureMode, LogEventPushDto }

export async function logFrontendEvents(events: LogEventBridgeDto[]): Promise<void> {
  if (!isDesktopRuntime() || events.length === 0) {
    return
  }

  await getPlatform().logging.logFrontendEvents(events)
}

/**
 * 订阅主进程实时推送的日志事件（前端桥接事件与主进程自身事件都会推送）。
 * 桌面运行时之外静默返回空取消函数。
 */
export async function listenLogEvent(
  handler: (events: LogEventPushDto[]) => void
): Promise<() => void> {
  if (!isDesktopRuntime()) {
    return () => undefined
  }

  return await getPlatform().logging.listenLogEvent(handler)
}

/**
 * 同步日志捕获模式到主进程（standard 沿用截断策略；full 长文本/图片 base64 不截断）。
 * 桌面运行时之外静默忽略。
 */
export async function setLogCaptureMode(mode: LogCaptureMode): Promise<void> {
  if (!isDesktopRuntime()) {
    return
  }

  await getPlatform().logging.setCaptureConfig(mode)
}

/**
 * 读取主进程当前的日志捕获模式。用于独立日志窗口挂载时同步真实状态——
 * 日志窗口是独立渲染进程，`settingsStore` 的 `logCaptureMode` 本地默认值为 `standard`，
 * 与主窗口此前可能已切到 `full` 的主进程真实状态可能不一致，需要主动拉取一次纠正。
 * 桌面运行时之外静默返回默认值 `standard`。
 */
export async function getLogCaptureMode(): Promise<LogCaptureMode> {
  if (!isDesktopRuntime()) {
    return 'standard'
  }

  return await getPlatform().logging.getCaptureConfig()
}

/** 打开（或聚焦已存在的）独立日志窗口（2.1 日志窗口骨架）。桌面运行时之外静默忽略。 */
export async function openLogWindow(): Promise<void> {
  if (!isDesktopRuntime()) {
    return
  }

  await getPlatform().logging.openLogWindow()
}
