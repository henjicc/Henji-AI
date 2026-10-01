import type { BrowserWindow, Display, Point, Rectangle, Size } from 'electron'

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

/** Temporary development/test placement; Windows monitor numbers are not Electron IDs. */
export function resolveDevelopmentWindowPosition(value: string | undefined, size: Size, displays: readonly Pick<Display, 'bounds' | 'workArea'>[]): Point | undefined {
  if (!value || !/^-?\d+,-?\d+$/.test(value)) return undefined
  const [x, y] = value.split(',').map(Number)
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return undefined
  const display = displays.find(({ bounds }) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height)
  return display ? resolveInitialWindowPosition(size, display.workArea) : undefined
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
  // 后台启动也先准备最大化状态，保证首次从 Dock 恢复时与前台启动一致。
  win.maximize()
  if (mode === 'background') {
    win.minimize()
    return
  }
  win.show()
}
