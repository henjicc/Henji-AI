import { PlatformNotImplementedError } from '@/platform/types'
import type { AiRuntimePlatform } from '@/platform/contracts/aiRuntime'

const DOMAIN = 'aiRuntime'

export function createElectronAiRuntime(): AiRuntimePlatform {
  return {
    setProviderApiKey: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'setProviderApiKey')
    },
    removeProviderApiKey: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'removeProviderApiKey')
    },
    getProviderApiKey: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'getProviderApiKey')
    },
    getProviderKeyStatus: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'getProviderKeyStatus')
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
