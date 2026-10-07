// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { videoEditKeyboardCommand } from './videoEditKeyboard'
const event = (target: EventTarget | null, code: string, ctrlKey = false) => ({ target, code, key: code, ctrlKey, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false })
it('效果控件Delete和Backspace作用于效果，时间线作用于片段，输入与自定义键位遵守注册表', () => {
  const panel = document.createElement('div'); panel.dataset.videoEditPanel = 'effects'
  const header = document.createElement('div'); panel.append(header)
  for (const code of ['Delete', 'Backspace']) expect(videoEditKeyboardCommand(event(header, code), 'timeline', {})).toEqual({ id: 'delete_effect', scope: 'effects' })
  const config = { delete_effect: { code: 'F9', ctrl: false, alt: false, shift: false, meta: false } }
  expect(videoEditKeyboardCommand(event(header, 'Delete'), 'timeline', config)).toBeUndefined()
  expect(videoEditKeyboardCommand(event(header, 'F9'), 'timeline', config)).toEqual({ id: 'delete_effect', scope: 'effects' })
  const input = document.createElement('input'); panel.append(input)
  expect(videoEditKeyboardCommand(event(input, 'F9'), 'timeline', config)).toBeUndefined()
  panel.dataset.videoEditPanel = 'timeline'
  expect(videoEditKeyboardCommand(event(header, 'Delete'), 'effects', config)).toEqual({ id: 'delete', scope: 'timeline' })
})
it('节目画面 T/V 切换文字和选择，纯文本就地编辑保留 T/V 输入', () => {
  const panel = document.createElement('div'); panel.dataset.videoEditPanel = 'program'
  const picture = document.createElement('div'); panel.append(picture)
  expect(videoEditKeyboardCommand(event(picture, 'KeyT'), 'timeline', {})).toEqual({ id: 'type_tool', scope: 'program' })
  expect(videoEditKeyboardCommand(event(picture, 'KeyV'), 'timeline', {})).toEqual({ id: 'select_tool', scope: 'program' })
  const editor = document.createElement('div'); editor.setAttribute('contenteditable', 'plaintext-only'); picture.append(editor)
  expect(videoEditKeyboardCommand(event(editor, 'KeyT'), 'timeline', {})).toBeUndefined()
  expect(videoEditKeyboardCommand(event(editor, 'KeyV'), 'timeline', {})).toBeUndefined()
})
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

it('系统浮窗（另一 realm 文档）中的输入框与面板范围同样生效，浮窗内模态框也让出键盘', () => {
  const frame = document.createElement('iframe'); document.body.append(frame)
  const popout = frame.contentDocument!
  const panel = popout.createElement('div'); panel.dataset.videoEditPanel = 'source'; popout.body.append(panel)
  const input = popout.createElement('input'); panel.append(input)
  const plain = popout.createElement('div'); panel.append(plain)
  expect(input instanceof HTMLElement).toBe(false)
  expect(videoEditKeyboardCommand(event(input, 'KeyI'), 'timeline', {})).toBeUndefined()
  expect(videoEditKeyboardCommand(event(input, 'Delete'), 'timeline', {})).toBeUndefined()
  expect(videoEditKeyboardCommand(event(plain, 'KeyI'), 'timeline', {})).toEqual({ id: 'mark_in', scope: 'source' })
  const modal = popout.createElement('div'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); popout.body.append(modal)
  expect(videoEditKeyboardCommand(event(plain, 'KeyI'), 'timeline', {})).toBeUndefined()
  frame.remove()
})
