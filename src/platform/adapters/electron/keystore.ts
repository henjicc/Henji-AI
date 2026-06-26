import { PlatformNotImplementedError } from '@/platform/types'
import type { KeystorePlatform } from '@/platform/contracts/keystore'

const DOMAIN = 'keystore'

export function createElectronKeystore(): KeystorePlatform {
  return {
    setKey: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'setKey')
    },
    removeKey: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'removeKey')
    },
    getKey: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'getKey')
    },
    hasKey: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'hasKey')
    },
  }
}
