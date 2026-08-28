import type { BrowserWindow } from 'electron'

export const BACKGROUND_WINDOW_SWITCH = '--background'

export type WindowPresentationMode = 'foreground' | 'background'

type PresentableWindow = Pick<BrowserWindow, 'maximize' | 'minimize' | 'show'>

export function resolveWindowPresentationMode(
  argv: string[] = process.argv.slice(1),
): WindowPresentationMode {
  return argv.includes(BACKGROUND_WINDOW_SWITCH) ? 'background' : 'foreground'
}

export function resolveBackgroundThrottling(mode: WindowPresentationMode): boolean {
  return mode !== 'background'
}

export function presentWindow(
  win: PresentableWindow,
  mode: WindowPresentationMode,
): void {
  if (mode === 'background') {
    win.minimize()
    return
  }
  win.maximize()
  win.show()
}
