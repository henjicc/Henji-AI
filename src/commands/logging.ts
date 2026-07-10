import type { LogEventBridgeDto } from '@/core/logging/types'
import type { LogCaptureMode, LogEventPushDto } from '@/platform/contracts/logging'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'

export type { LogCaptureMode, LogEventPushDto }

export interface RuntimeRequestPreviewDto {
  requestId: string
  taskId?: string
  modelId: string
  providerId: string
  method: string
  route: string
  requestBody: DynamicValue
}

export interface LlmRuntimeRequestPreviewDto {
  requestId: string
  modelId: string
  providerId: string
  method: string
  route: string
  requestBody: DynamicValue
}

export async function logFrontendEvents(events: LogEventBridgeDto[]): Promise<void> {
  if (!isDesktopRuntime() || events.length === 0) {
    return
  }

  await getPlatform().logging.logFrontendEvents(events)
}

export async function listenRuntimeRequestPreview(
  handler: (payload: RuntimeRequestPreviewDto) => void
): Promise<() => void> {
  if (!isDesktopRuntime()) {
    return () => undefined
  }

  return await getPlatform().logging.listenRuntimeRequestPreview(handler)
}

export async function listenLlmRuntimeRequestPreview(
  handler: (payload: LlmRuntimeRequestPreviewDto) => void
): Promise<() => void> {
  if (!isDesktopRuntime()) {
    return () => undefined
  }

  return await getPlatform().logging.listenLlmRuntimeRequestPreview(handler)
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
