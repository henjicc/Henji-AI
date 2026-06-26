import { PlatformNotImplementedError } from '@/platform/types'
import type { LlmRuntimePlatform } from '@/platform/contracts/llmRuntime'

const DOMAIN = 'llmRuntime'

export function createElectronLlmRuntime(): LlmRuntimePlatform {
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
    chatStream: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'chatStream')
    },
    cancelTask: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'cancelTask')
    },
  }
}
