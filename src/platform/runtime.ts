import type { PlatformRuntime } from '@/platform/contracts'
import type { ShellKind } from '@/platform/types'
import { createTauriPlatform } from '@/platform/adapters/tauri'
import { createElectronPlatform } from '@/platform/adapters/electron'

declare global {
  interface Window {
    henjiNative?: unknown
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }
}

export function detectShell(): ShellKind | null {
  if (typeof window === 'undefined') return null

  if (window.henjiNative) return 'electron'
  if (window.__TAURI__ || window.__TAURI_INTERNALS__) return 'tauri'

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Electron\//.test(ua)) return 'electron'
  if (/Tauri|Wry/i.test(ua)) return 'tauri'

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
    throw new Error('Platform runtime is only available inside a desktop shell (Tauri/Electron)')
  }

  if (cachedPlatform && cachedShell === shell) {
    return cachedPlatform
  }

  cachedPlatform = shell === 'tauri' ? createTauriPlatform() : createElectronPlatform()
  cachedShell = shell
  return cachedPlatform
}
