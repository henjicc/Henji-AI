import { appLocalDataDir } from '@/platform/desktopApi'
import { isDesktopRuntime } from '@/platform/runtime'

export const isDesktop = (): boolean => {
  return isDesktopRuntime()
}

export const isDesktopAsync = async (): Promise<boolean> => {
  try {
    await appLocalDataDir()
    return true
  } catch {
    return false
  }
}
