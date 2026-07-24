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
    listenLogEvent: async (handler) => {
      return getNativeLogging().onLogEvent(handler)
    },
    setCaptureConfig: async (mode) => {
      await getNativeLogging().setCaptureConfig(mode)
    },
    getCaptureConfig: async () => {
      return await getNativeLogging().getCaptureConfig()
    },
    openLogWindow: async () => {
      await getNativeLogging().openLogWindow()
    },
    listLogDates: async () => {
      return await getNativeLogging().listLogDates()
    },
    queryLogEvents: async (params) => {
      return await getNativeLogging().queryLogEvents(params)
    },
    getAgentTraceCaptureMode: async () => {
      return await getNativeLogging().getAgentTraceCaptureMode()
    },
    setAgentTraceCaptureMode: async (mode) => {
      await getNativeLogging().setAgentTraceCaptureMode(mode)
    },
    queryAgentTraces: async (params) => {
      return await getNativeLogging().queryAgentTraces(params)
    },
    getAgentTraceDetail: async (traceId) => {
      return await getNativeLogging().getAgentTraceDetail(traceId)
    },
    clearAgentTraces: async (date) => {
      await getNativeLogging().clearAgentTraces(date)
    },
  }
}
