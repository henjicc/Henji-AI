import type { AppMenuNativeMenu } from '../../core/appMenu/appMenu'

export interface AppMenuPlatform {
  update: (menus: AppMenuNativeMenu[]) => Promise<void>
  onInvoke: (listener: (payload: { id: string }) => void) => () => void
}
