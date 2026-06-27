import type { LogEventBridgeDto } from '@/core/logging/types'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'

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
