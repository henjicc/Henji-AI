import { afterEach, expect, it, vi } from 'vitest'
import { EventType, UiohookKey, uIOhook, type UiohookKeyboardEvent, type UiohookMouseEvent, type UiohookWheelEvent } from 'uiohook-napi'
import { keyCategory, startDesktopInput } from './input-events'
import { capabilityCaptureSchema, captureEventSchema } from '../../../../src/core/captureLog/events'

// 不 importActual：包在读取常量时就初始化 X11/桌面原生绑定。
vi.mock('uiohook-napi', () => ({
  EventType: { EVENT_KEY_PRESSED: 4, EVENT_MOUSE_PRESSED: 7, EVENT_MOUSE_RELEASED: 8, EVENT_MOUSE_WHEEL: 11 },
  UiohookKey: { A: 0x001E, B: 0x0030, C: 0x002E, V: 0x002F, X: 0x002D, Y: 0x0015, Z: 0x002C, Space: 0x0039, Backspace: 0x000E,
    Enter: 0x001C, Escape: 0x0001, Tab: 0x000F, ArrowDown: 0xE050, ArrowUp: 0xE048, ArrowLeft: 0xE04B, ArrowRight: 0xE04D,
    Home: 0x0E47, End: 0x0E4F, PageDown: 0x0E51, PageUp: 0x0E49 },
  uIOhook: { on: vi.fn(), off: vi.fn(), start: vi.fn(), stop: vi.fn() },
}))
afterEach(() => { vi.resetAllMocks() })

it('输入只记类别，普通文字与密码没有字符内容出口', () => {
  const base = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }
  for (const keycode of [UiohookKey.A, UiohookKey.B, UiohookKey.Space, UiohookKey.Backspace]) expect(keyCategory({ ...base, keycode })).toBe('typing')
  expect(keyCategory({ ...base, keycode: UiohookKey.C, ctrlKey: true })).toBe('copy')
  expect(keyCategory({ ...base, keycode: UiohookKey.Z, metaKey: true, shiftKey: true })).toBe('redo')
  expect(keyCategory({ ...base, keycode: UiohookKey.ArrowLeft })).toBe('navigation')
  expect(captureEventSchema.safeParse({ kind: 'key', category: 'typing', keycode: UiohookKey.A }).success).toBe(false)
  const fact = { callId: 'call', capability: 'read_application_entity', targets: [{ kind: 'video_edit.document', id: 'doc' }], phase: 'completed' }
  expect(capabilityCaptureSchema.safeParse(fact).success).toBe(true)
  expect(capabilityCaptureSchema.safeParse({ ...fact, input: { password: 'secret' } }).success).toBe(false)
  expect(capabilityCaptureSchema.safeParse({ ...fact, targets: [{ ...fact.targets[0], label: 'secret' }] }).success).toBe(false)
})

it('输入钩子只转发类别和鼠标事件，释放幂等，启动失败移除监听并停止', () => {
  const listener = vi.fn()
  const stop = startDesktopInput(listener)
  const onInput = vi.mocked(uIOhook.on).mock.calls[0][1] as (event: UiohookKeyboardEvent | UiohookMouseEvent | UiohookWheelEvent) => void
  const base = { time: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }
  const key: UiohookKeyboardEvent = { ...base, type: EventType.EVENT_KEY_PRESSED, keycode: UiohookKey.C, ctrlKey: true }
  const mouse: UiohookMouseEvent = { ...base, type: EventType.EVENT_MOUSE_PRESSED, x: 12, y: 34, button: 1, clicks: 1 }
  onInput(key); onInput(mouse)
  expect(listener.mock.calls).toEqual([[{ kind: 'key', category: 'copy' }], [{ kind: 'mouse', event: mouse }]])
  stop(); stop()
  expect(uIOhook.off).toHaveBeenCalledWith('input', onInput)
  expect(uIOhook.stop).toHaveBeenCalledTimes(1)
  vi.mocked(uIOhook.start).mockImplementationOnce(() => { throw new Error('input denied') })
  expect(() => startDesktopInput(listener)).toThrow('input denied')
  expect(uIOhook.off).toHaveBeenCalledTimes(2)
  expect(uIOhook.stop).toHaveBeenCalledTimes(2)
})
