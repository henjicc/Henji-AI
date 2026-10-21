import { SOUND_LIBRARY_IPC_CHANNELS, type SoundLibraryPlatform, type SoundLibraryState } from '../../src/platform/contracts/soundLibrary'

type NativeInvoke = <T>(channel: string, payload?: unknown) => Promise<T>
type Subscribe = (channel: string, listener: (payload: unknown) => void) => () => void

/** 音效库桥：方法与 SoundLibraryPlatform 一一对应，通道表与主进程共用。 */
export function createSoundLibraryApi(invoke: NativeInvoke, subscribe: Subscribe): SoundLibraryPlatform {
  const c = SOUND_LIBRARY_IPC_CHANNELS
  return {
    getState: () => invoke(c.getState),
    addFolder: () => invoke(c.addFolder),
    removeFolder: (id) => invoke(c.removeFolder, { id }),
    refresh: (folderIds) => invoke(c.refresh, folderIds ? { folderIds } : {}),
    search: (request) => invoke(c.search, request),
    locate: (id) => invoke(c.locate, { id }),
    listSounds: (offset, limit) => invoke(c.listSounds, { offset, limit }),
    onChanged: (handler) => subscribe(c.changed, (payload) => handler(payload as SoundLibraryState)),
  }
}
