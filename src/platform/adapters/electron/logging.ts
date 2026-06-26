import { PlatformNotImplementedError } from '@/platform/types'
import type { LoggingPlatform } from '@/platform/contracts/logging'

const DOMAIN = 'logging'

export function createElectronLogging(): LoggingPlatform {
  return {
    logFrontendEvents: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'logFrontendEvents')
    },
    listenRuntimeRequestPreview: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'listenRuntimeRequestPreview')
    },
    listenLlmRuntimeRequestPreview: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'listenLlmRuntimeRequestPreview')
    },
  }
}
