import type { AiRuntimePlatform } from '@/platform/contracts/aiRuntime'

const DOMAIN = 'aiRuntime'

function getNativeAi(): NonNullable<typeof window.henjiNative>['ai'] {
  const native = window.henjiNative
  if (!native?.ai) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.ai is not available`)
  }
  return native.ai
}

export function createElectronAiRuntime(): AiRuntimePlatform {
  return {
    setProviderApiKey: async (providerId, apiKey) => {
      await getNativeAi().setProviderApiKey(providerId, apiKey)
    },
    removeProviderApiKey: async (providerId) => {
      await getNativeAi().removeProviderApiKey(providerId)
    },
    getProviderApiKey: async (providerId) => {
      return await getNativeAi().getProviderApiKey(providerId)
    },
    getProviderKeyStatus: async () => {
      return await getNativeAi().getProviderKeyStatus()
    },
    testProviderConnection: async (providerId) => {
      return await getNativeAi().testProviderConnection(providerId)
    },
    generate: async (request) => {
      return await getNativeAi().generate(request)
    },
    continuePolling: async (request) => {
      return await getNativeAi().continuePolling(request)
    },
    cancelTask: async (taskId) => {
      await getNativeAi().cancelTask(taskId)
    },
    getProgressEstimate: async (request) => {
      return await getNativeAi().getProgressEstimate(request)
    },
    recordProgressSample: async (request) => {
      return await getNativeAi().recordProgressSample(request)
    },
  }
}
