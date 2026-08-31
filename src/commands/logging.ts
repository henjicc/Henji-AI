import type { LogEventBridgeDto } from '@/core/logging/types'
import type {
  ImageEditorDiagnosticBundleRequest,
  ImageEditorDiagnosticBundleResult,
} from '@/core/logging/diagnosticBundle'
import type {
  AgentTraceCaptureMode,
  AgentTraceDetailResult,
  AgentTraceQuery,
  AgentTraceQueryResult,
} from '@/core/assistant/trace'
import type { LogCaptureMode, LogEventPushDto, LogQueryParams, LogQueryResult } from '@/platform/contracts/logging'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'

export type { LogCaptureMode, LogEventPushDto, LogQueryParams, LogQueryResult }
export type { AgentTraceCaptureMode, AgentTraceDetailResult, AgentTraceQuery, AgentTraceQueryResult }

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

/**
 * 列出当前存在的历史日志文件对应的日期（降序，最近的在前）。桌面运行时之外静默返回空数组。
 * 用于历史模式的日期选择器（2.3 历史日志回读）。
 */
export async function listLogDates(): Promise<string[]> {
  if (!isDesktopRuntime()) {
    return []
  }

  return await getPlatform().logging.listLogDates()
}

/**
 * 按日期流式查询历史日志事件，过滤（level/source/domainPrefix/requestId/keyword）与分页
 * （beforeTimestamp 游标 + limit）均在主进程完成，不整文件传给渲染层。
 * 桌面运行时之外静默返回空结果。
 */
export async function queryLogEvents(params: LogQueryParams): Promise<LogQueryResult> {
  if (!isDesktopRuntime()) {
    return { events: [], hasMore: false, corruptedLines: 0 }
  }

  return await getPlatform().logging.queryLogEvents(params)
}

export async function exportDiagnosticBundle(
  request: ImageEditorDiagnosticBundleRequest,
): Promise<ImageEditorDiagnosticBundleResult> {
  if (!isDesktopRuntime()) return { status: 'cancelled' }
  return await getPlatform().logging.exportDiagnosticBundle(request)
}

export async function getAgentTraceCaptureMode(): Promise<AgentTraceCaptureMode> {
  if (!isDesktopRuntime()) return 'summary'
  return await getPlatform().logging.getAgentTraceCaptureMode()
}

export async function setAgentTraceCaptureMode(mode: AgentTraceCaptureMode): Promise<void> {
  if (!isDesktopRuntime()) return
  await getPlatform().logging.setAgentTraceCaptureMode(mode)
}

export async function queryAgentTraces(params: AgentTraceQuery): Promise<AgentTraceQueryResult> {
  if (!isDesktopRuntime()) return { runs: [], hasMore: false }
  return await getPlatform().logging.queryAgentTraces(params)
}

export async function getAgentTraceDetail(traceId: string): Promise<AgentTraceDetailResult | null> {
  if (!isDesktopRuntime()) return null
  return await getPlatform().logging.getAgentTraceDetail(traceId)
}

export async function clearAgentTraces(date?: string): Promise<void> {
  if (!isDesktopRuntime()) return
  await getPlatform().logging.clearAgentTraces(date)
}
