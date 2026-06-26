import { PlatformNotImplementedError } from '@/platform/types'
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
    generate: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'generate')
    },
    continuePolling: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'continuePolling')
    },
    cancelTask: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'cancelTask')
    },
    reloadModelManifest: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'reloadModelManifest')
    },
    getProgressEstimate: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'getProgressEstimate')
    },
    recordProgressSample: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'recordProgressSample')
    },
  }
}
