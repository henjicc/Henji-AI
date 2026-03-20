import type { LogEventBridgeDto } from '@/core/logging/types'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface RuntimeRequestPreviewDto {
  requestId: string
  taskId?: string
  modelId: string
  providerId: string
  method: string
  route: string
  requestBody: unknown
}

export async function logFrontendEvents(events: LogEventBridgeDto[]): Promise<void> {
  if (!isTauri() || events.length === 0) {
    return
  }

  await invoke('log_frontend_events', {
    events,
  })
}

export async function listenRuntimeRequestPreview(
  handler: (payload: RuntimeRequestPreviewDto) => void
): Promise<() => void> {
  if (!isTauri()) {
    return () => undefined
  }

  return listen<RuntimeRequestPreviewDto>('henji://runtime-request-preview', (event) => {
    handler(event.payload)
  })
}
