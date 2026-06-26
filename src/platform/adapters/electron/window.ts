import { PlatformNotImplementedError } from '@/platform/types'
import type { WindowPlatform } from '@/platform/contracts/window'

const DOMAIN = 'window'

export function createElectronWindow(): WindowPlatform {
  return {
    minimize: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'minimize')
    },
    toggleMaximize: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'toggleMaximize')
    },
    close: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'close')
    },
    isMaximized: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'isMaximized')
    },
    onResized: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'onResized')
    },
    toggleDevTools: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'toggleDevTools')
    },
  }
}
