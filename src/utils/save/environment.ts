import { isDesktopRuntime } from '@/platform/runtime'

export const isDesktop = (): boolean => {
  return isDesktopRuntime()
}

