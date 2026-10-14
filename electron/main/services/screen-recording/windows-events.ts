import koffi from 'koffi'
import type { CaptureRect } from '../../../../src/core/captureLog/coordinates'
import type { cursorShapes } from '../../../../src/core/captureLog/events'

export interface DesktopWindowFact { windowId: string | null; bounds: CaptureRect | null; available: boolean }
export interface DesktopNativeFacts { cursor(): typeof cursorShapes[number]; foreground(): DesktopWindowFact }
/** No titles, process command lines or key contents are requested from the OS. */
export function createWindowsEventFacts(): DesktopNativeFacts {
  if (process.platform !== 'win32') return { cursor: () => 'unknown', foreground: () => ({ windowId: null, bounds: null, available: false }) }
  const lib = koffi.load('user32.dll')
  const point = koffi.struct({ x: 'int32', y: 'int32' })
  const info = koffi.struct({ cbSize: 'uint32', flags: 'uint32', hCursor: 'void *', ptScreenPos: point })
  const rect = koffi.struct({ left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
  const getCursor = lib.func('__stdcall', 'GetCursorInfo', 'int', [koffi.inout(koffi.pointer(info))])
  const loadCursor = lib.func('__stdcall', 'LoadCursorW', 'void *', ['void *', 'uintptr_t'])
  const getWindow = lib.func('__stdcall', 'GetForegroundWindow', 'void *', [])
  const getRect = lib.func('__stdcall', 'GetWindowRect', 'int', ['void *', koffi.out(koffi.pointer(rect))])
  const shapes = new Map<string, typeof cursorShapes[number]>()
  for (const [id, shape] of [[32512, 'arrow'], [32513, 'text'], [32514, 'wait'], [32515, 'crosshair'], [32649, 'hand'], [32650, 'progress'], [32644, 'resize-horizontal'], [32645, 'resize-vertical'], [32642, 'resize-diagonal'], [32643, 'resize-diagonal'], [32646, 'move'], [32648, 'forbidden']] as const) {
    const handle: unknown = loadCursor(null, id)
    if (handle !== null) shapes.set(String(handle), shape)
  }
  return {
    cursor: () => {
      const value = { cbSize: koffi.sizeof(info), flags: 0, hCursor: null as unknown, ptScreenPos: { x: 0, y: 0 } }
      if (!getCursor(value)) return 'unknown'
      return value.flags & 1 ? shapes.get(String(value.hCursor)) ?? 'unknown' : 'hidden'
    },
    foreground: () => {
      const handle: unknown = getWindow()
      const value = { left: 0, top: 0, right: 0, bottom: 0 }
      if (handle === null || !getRect(handle, value) || value.right <= value.left || value.bottom <= value.top) return { windowId: null, bounds: null, available: false }
      return { windowId: String(handle), bounds: { x: value.left, y: value.top, width: value.right - value.left, height: value.bottom - value.top }, available: true }
    },
  }
}
