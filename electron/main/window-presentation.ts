import type { BrowserWindow, Point, Rectangle, Size } from 'electron'

export const BACKGROUND_WINDOW_SWITCH = '--background'

export type WindowPresentationMode = 'foreground' | 'background'

type PresentableWindow = Pick<BrowserWindow, 'maximize' | 'minimize' | 'show'>

/** 首次显示前就避开菜单栏和 Dock，不让 macOS 在展开动画后修正无边框窗口位置。 */
export function resolveInitialWindowPosition(size: Size, workArea: Rectangle): Point {
  return {
    x: workArea.x + Math.max(0, Math.floor((workArea.width - size.width) / 2)),
    y: workArea.y + Math.max(0, Math.floor((workArea.height - size.height) / 2)),
  }
}

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
