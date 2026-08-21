import type { WindowPlatform } from '@/platform/contracts/window'
import type { UiScaleFactor, WindowContentSize } from '@/core/theme/uiScale'

const DOMAIN = 'window'

interface ElectronWindowState {
  isMaximized: boolean
}

interface ElectronWindowApi {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  getContentSize(): Promise<WindowContentSize>
  setZoomFactor(factor: UiScaleFactor): Promise<void>
  onStateChanged(handler: (state: ElectronWindowState) => void): () => void
  toggleDevTools(): Promise<void>
}

interface ElectronNativeApi {
  window?: ElectronWindowApi
}

function getWindowApi(): ElectronWindowApi {
  const native = window.henjiNative as ElectronNativeApi | undefined
  if (!native?.window) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.window is not available`)
  }
  return native.window
}

export function createElectronWindow(): WindowPlatform {
  return {
    async minimize() {
      await getWindowApi().minimize()
    },
    async toggleMaximize() {
      await getWindowApi().toggleMaximize()
    },
    async close() {
      await getWindowApi().close()
    },
    async isMaximized() {
      return await getWindowApi().isMaximized()
    },
    async getContentSize() {
      return await getWindowApi().getContentSize()
    },
    async setZoomFactor(factor) {
      await getWindowApi().setZoomFactor(factor)
    },
    onResized(handler) {
      return getWindowApi().onStateChanged(() => handler())
    },
    async toggleDevTools() {
      await getWindowApi().toggleDevTools()
    },
  }
}
