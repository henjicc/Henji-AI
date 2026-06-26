import type { UpdaterPlatform } from '@/platform/contracts/updater'
import { PlatformNotImplementedError } from '@/platform/types'

export function createTauriUpdater(): UpdaterPlatform {
  return {
    getStatus: async () => {
      throw new PlatformNotImplementedError('updater', 'getStatus')
    },
    checkForUpdates: async () => {
      throw new PlatformNotImplementedError('updater', 'checkForUpdates')
    },
    downloadUpdate: async () => {
      throw new PlatformNotImplementedError('updater', 'downloadUpdate')
    },
    quitAndInstall: async () => {
      throw new PlatformNotImplementedError('updater', 'quitAndInstall')
    },
    onEvent: () => () => undefined,
  }
}
