import { PlatformNotImplementedError } from '@/platform/types'
import type { MediaPlatform } from '@/platform/contracts/media'

const DOMAIN = 'media'

export function createElectronMedia(): MediaPlatform {
  return {
    toDisplaySrc: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'toDisplaySrc')
    },
    readLocalFileAsBlob: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'readLocalFileAsBlob')
    },
    readLocalFileAsDataUrl: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'readLocalFileAsDataUrl')
    },
  }
}
