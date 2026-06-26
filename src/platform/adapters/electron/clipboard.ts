import { PlatformNotImplementedError } from '@/platform/types'
import type { ClipboardPlatform } from '@/platform/contracts/clipboard'

const DOMAIN = 'clipboard'

export function createElectronClipboard(): ClipboardPlatform {
  return {
    readClipboardFiles: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'readClipboardFiles')
    },
    readText: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'readText')
    },
    writeImageFromPath: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'writeImageFromPath')
    },
    writeImageFromSource: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'writeImageFromSource')
    },
  }
}
