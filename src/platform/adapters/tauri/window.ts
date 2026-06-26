import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { WindowPlatform } from '@/platform/contracts/window'

export function createTauriWindow(): WindowPlatform {
  return {
    async minimize() {
      await getCurrentWindow().minimize()
    },
    async toggleMaximize() {
      await getCurrentWindow().toggleMaximize()
    },
    async close() {
      await getCurrentWindow().close()
    },
    async isMaximized() {
      return await getCurrentWindow().isMaximized()
    },
    onResized(handler) {
      const unlistenPromise = getCurrentWindow().onResized(() => handler())
      return () => {
        unlistenPromise.then((unlisten) => unlisten())
      }
    },
    async toggleDevTools() {
      await invoke('toggle_devtools')
    },
  }
}
