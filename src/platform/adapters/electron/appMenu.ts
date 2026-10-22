import type { AppMenuPlatform } from '../../contracts/appMenu'

export function createElectronAppMenu(): AppMenuPlatform {
  return {
    update: menus => window.henjiNative.appMenu.update(menus),
    onInvoke: listener => window.henjiNative.appMenu.onInvoke(listener),
  }
}
