import * as path from '@tauri-apps/api/path'

export const isDesktop = (): boolean => {
  const w: any = typeof window !== 'undefined' ? window : {}
  if (w && w.__TAURI__ && typeof w.__TAURI__.invoke === 'function') return true
  if (w && (w.__TAURI__ || w.__TAURI_INTERNALS__)) return true
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : ''
  return /Tauri|Wry/i.test(ua)
}

export const isDesktopAsync = async (): Promise<boolean> => {
  try {
    await path.appLocalDataDir()
    return true
  } catch {
    return false
  }
}

