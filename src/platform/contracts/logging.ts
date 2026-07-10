import type { LogEventBridgeDto } from '@/core/logging/types'

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

/**
 * 主进程实时推送的日志事件（含 `source`），与 `LogEventBridgeDto` 的区别是
 * 多了 `source: 'frontend' | 'backend'`，用于区分事件来自渲染层还是主进程自身。
 */
export interface LogEventPushDto extends LogEventBridgeDto {
  source: 'frontend' | 'backend'
}

export interface LoggingPlatform {
  logFrontendEvents(events: LogEventBridgeDto[]): Promise<void>
  listenRuntimeRequestPreview(handler: (payload: RuntimeRequestPreviewDto) => void): Promise<() => void>
  listenLlmRuntimeRequestPreview(
    handler: (payload: LlmRuntimeRequestPreviewDto) => void
  ): Promise<() => void>
  listenLogEvent(handler: (events: LogEventPushDto[]) => void): Promise<() => void>
}
