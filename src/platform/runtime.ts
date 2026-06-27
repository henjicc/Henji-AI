import type { PlatformRuntime } from '@/platform/contracts'
import type { ShellKind } from '@/platform/types'
import { createElectronPlatform } from '@/platform/adapters/electron'

declare global {
  interface Window {
    henjiNative?: unknown
  }
}

export function detectShell(): ShellKind | null {
  if (typeof window === 'undefined') return null

  if (window.henjiNative) return 'electron'

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Electron\//.test(ua)) return 'electron'

  return null
}

export function isDesktopRuntime(): boolean {
  return detectShell() !== null
}

let cachedPlatform: PlatformRuntime | null = null
let cachedShell: ShellKind | null = null

export function getPlatform(): PlatformRuntime {
  const shell = detectShell()
  if (!shell) {
    throw new Error('Platform runtime is only available inside the Electron desktop shell')
  }

  if (cachedPlatform && cachedShell === shell) {
    return cachedPlatform
  }

  cachedPlatform = createElectronPlatform()
  cachedShell = shell
  return cachedPlatform
}
