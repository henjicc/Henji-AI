import type { UpdaterEvent, UpdaterPlatform } from '@/platform/contracts/updater'

const DOMAIN = 'updater'

interface ElectronNativeApi {
  updater?: UpdaterPlatform
}

function getUpdaterApi(): UpdaterPlatform {
  const native = window.henjiNative as ElectronNativeApi | undefined
  if (!native?.updater) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.updater is not available`)
  }
  return native.updater
}

export function createElectronUpdater(): UpdaterPlatform {
  return {
    getStatus: async () => await getUpdaterApi().getStatus(),
    checkForUpdates: async () => await getUpdaterApi().checkForUpdates(),
    downloadUpdate: async () => await getUpdaterApi().downloadUpdate(),
    quitAndInstall: async () => await getUpdaterApi().quitAndInstall(),
    onEvent: (handler: (event: UpdaterEvent) => void) => getUpdaterApi().onEvent(handler),
  }
}
