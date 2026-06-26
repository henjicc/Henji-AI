import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { LogEventBridgeDto } from '@/core/logging/types'
import type {
  LlmRuntimeRequestPreviewDto,
  LoggingPlatform,
  RuntimeRequestPreviewDto,
} from '@/platform/contracts/logging'

export function createTauriLogging(): LoggingPlatform {
  return {
    async logFrontendEvents(events: LogEventBridgeDto[]) {
      if (events.length === 0) return
      await invoke('log_frontend_events', { events })
    },
    async listenRuntimeRequestPreview(handler) {
      return await listen<RuntimeRequestPreviewDto>('henji://runtime-request-preview', (event) => {
        handler(event.payload)
      })
    },
    async listenLlmRuntimeRequestPreview(handler) {
      return await listen<LlmRuntimeRequestPreviewDto>('henji://llm-runtime-request-preview', (event) => {
        handler(event.payload)
      })
    },
  }
}
