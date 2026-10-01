// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { videoEditKeyboardCommand } from './videoEditKeyboard'
const event = (target: EventTarget | null, code: string, ctrlKey = false) => ({ target, code, key: code, ctrlKey, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false })
it('当前真实面板限定命令；输入、原生按钮和弹窗保留自己的键盘行为', () => {
  const source = document.createElement('div'); source.dataset.videoEditPanel = 'source'
  const child = document.createElement('div'); source.append(child)
  expect(videoEditKeyboardCommand(event(child, 'KeyI'), 'timeline', {})).toEqual({ id: 'mark_in', scope: 'source' })
  expect(videoEditKeyboardCommand(event(child, 'KeyV'), 'timeline', {})).toBeUndefined()
  for (const selector of ['input', 'textarea', 'select', 'button']) {
    const native = document.createElement(selector); source.append(native)
    expect(videoEditKeyboardCommand(event(native, 'Space'), 'timeline', {})).toBeUndefined()
  }
  const button = document.createElement('div'); button.setAttribute('role', 'button'); source.append(button)
  expect(videoEditKeyboardCommand(event(button, 'Space'), 'timeline', {})).toBeUndefined()
  const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); modal.append(child)
  expect(videoEditKeyboardCommand(event(child, 'KeyS', true), 'timeline', {})).toBeUndefined()
  for (const role of ['listbox', 'option']) {
    const portal = document.createElement('div'); portal.setAttribute('role', role); portal.append(child)
    expect(videoEditKeyboardCommand(event(child, 'KeyZ', true), 'timeline', {})).toBeUndefined()
    expect(videoEditKeyboardCommand(event(child, 'Delete'), 'timeline', {})).toBeUndefined()
  }
  const activeModal = document.createElement('div'); activeModal.setAttribute('role', 'dialog'); activeModal.setAttribute('aria-modal', 'true'); document.body.append(activeModal)
  const oldFocus = document.createElement('div')
  expect(videoEditKeyboardCommand(event(oldFocus, 'KeyZ', true), 'timeline', {})).toBeUndefined()
  activeModal.remove()
})
