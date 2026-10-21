import type { SoundLibraryPlatform } from '@/platform/contracts/soundLibrary'

const DOMAIN = 'soundLibrary'

function getNativeSoundLibrary(): SoundLibraryPlatform {
  const native = window.henjiNative
  if (!native?.soundLibrary) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.soundLibrary is not available`)
  }
  return native.soundLibrary
}

/** 音效库：preload 桥已按 SoundLibraryPlatform 实现，这里只做可用性检查与转发。 */
export function createElectronSoundLibrary(): SoundLibraryPlatform {
  return {
    getState: () => getNativeSoundLibrary().getState(),
    addFolder: () => getNativeSoundLibrary().addFolder(),
    removeFolder: (id) => getNativeSoundLibrary().removeFolder(id),
    refresh: (folderIds) => getNativeSoundLibrary().refresh(folderIds),
    search: (request) => getNativeSoundLibrary().search(request),
    locate: (id) => getNativeSoundLibrary().locate(id),
    listSounds: (offset, limit) => getNativeSoundLibrary().listSounds(offset, limit),
    onChanged: (handler) => getNativeSoundLibrary().onChanged(handler),
  }
}
