import { EventType, UiohookKey, uIOhook, type UiohookKeyboardEvent, type UiohookMouseEvent, type UiohookWheelEvent } from 'uiohook-napi'
import type { CapturePayload } from '../../../../src/core/captureLog/events'

export function keyCategory(event: Pick<UiohookKeyboardEvent, 'keycode' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): Extract<CapturePayload, { kind: 'key' }>['category'] {
  if (event.altKey) return 'shortcut'
  if (event.ctrlKey || event.metaKey) {
    if (event.keycode === UiohookKey.Z) return event.shiftKey ? 'redo' : 'undo'
    const categories: Record<number, 'copy' | 'paste' | 'cut' | 'redo' | 'select-all'> = { [UiohookKey.C]: 'copy', [UiohookKey.V]: 'paste', [UiohookKey.X]: 'cut', [UiohookKey.Y]: 'redo', [UiohookKey.A]: 'select-all' }
    return categories[event.keycode] ?? 'shortcut'
  }
  if (event.keycode === UiohookKey.Enter) return 'confirm'
  if (event.keycode === UiohookKey.Escape) return 'cancel'
  if ([UiohookKey.Tab, UiohookKey.ArrowDown, UiohookKey.ArrowUp, UiohookKey.ArrowLeft, UiohookKey.ArrowRight, UiohookKey.Home, UiohookKey.End, UiohookKey.PageDown, UiohookKey.PageUp].some(key => key === event.keycode)) return 'navigation'
  return 'typing'
}

/** libuiohook reports moves with a button held as "dragged" (10); uiohook-napi passes it through without naming it. */
export const MOUSE_DRAGGED = 10 as EventType
export function startDesktopInput(listener: (payload: CapturePayload | { kind: 'mouse'; event: UiohookMouseEvent | UiohookWheelEvent }) => void): () => void {
  const onInput = (event: UiohookKeyboardEvent | UiohookMouseEvent | UiohookWheelEvent): void => {
    if (event.type === EventType.EVENT_KEY_PRESSED) listener({ kind: 'key', category: keyCategory(event as UiohookKeyboardEvent) })
    else if ([EventType.EVENT_MOUSE_PRESSED, EventType.EVENT_MOUSE_RELEASED, EventType.EVENT_MOUSE_WHEEL, EventType.EVENT_MOUSE_MOVED, MOUSE_DRAGGED].includes(event.type)) listener({ kind: 'mouse', event: event as UiohookMouseEvent | UiohookWheelEvent })
  }
  uIOhook.on('input', onInput)
  try { uIOhook.start() } catch (error) { uIOhook.off('input', onInput); try { uIOhook.stop() } catch { /* Original start failure remains authoritative. */ } throw error }
  let stopped = false
  return () => { if (stopped) return; stopped = true; uIOhook.off('input', onInput); uIOhook.stop() }
}
