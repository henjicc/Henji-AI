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

export interface LoggingPlatform {
  logFrontendEvents(events: LogEventBridgeDto[]): Promise<void>
  listenRuntimeRequestPreview(handler: (payload: RuntimeRequestPreviewDto) => void): Promise<() => void>
  listenLlmRuntimeRequestPreview(
    handler: (payload: LlmRuntimeRequestPreviewDto) => void
  ): Promise<() => void>
}
