import type { BrowserWindow } from 'electron'

export const BACKGROUND_WINDOW_SWITCH = '--background'

export type WindowPresentationMode = 'foreground' | 'background'

type PresentableWindow = Pick<BrowserWindow, 'maximize' | 'show' | 'showInactive'>

export function resolveWindowPresentationMode(
  argv: string[] = process.argv.slice(1),
): WindowPresentationMode {
  return argv.includes(BACKGROUND_WINDOW_SWITCH) ? 'background' : 'foreground'
}

export function presentWindow(
  win: PresentableWindow,
  mode: WindowPresentationMode,
): void {
  if (mode === 'background') {
    win.showInactive()
    win.maximize()
    return
  }
  win.maximize()
  win.show()
}
