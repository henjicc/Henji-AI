import type { LoggingPlatform } from '@/platform/contracts/logging'

const DOMAIN = 'logging'

function getNativeLogging(): NonNullable<typeof window.henjiNative>['logging'] {
  const native = window.henjiNative
  if (!native?.logging) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.logging is not available`)
  }
  return native.logging
}

export function createElectronLogging(): LoggingPlatform {
  return {
    logFrontendEvents: async (events) => {
      await getNativeLogging().logFrontendEvents(events)
    },
    listenRuntimeRequestPreview: async (handler) => {
      return getNativeLogging().onRuntimeRequestPreview(handler)
    },
    listenLlmRuntimeRequestPreview: async (handler) => {
      return getNativeLogging().onLlmRuntimeRequestPreview(handler)
    },
  }
}
