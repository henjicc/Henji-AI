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
it('焦点所在面板决定作用域：没有自己命令的面板里传输与导航照常作用于序列，编辑命令不落到时间线', () => {
  // 跟踪、调色、标题模板、风格、代码面板只出现在播放命令的作用域里，同样算没有专属命令
  for (const id of ['scenes', 'presets', 'audio_mixer', 'tracking', 'color_grade', 'title_templates', 'style_kits', 'code_project']) {
    const panel = document.createElement('div'); panel.dataset.videoEditPanel = id
    const row = document.createElement('button'); panel.append(row)
    // activePanel 还停在时间线（Dock 激活事件没跟上这次点击）
    for (const code of ['Delete', 'Semicolon']) expect(videoEditKeyboardCommand(event(row, code), 'timeline', {})).toBeUndefined()
    expect(videoEditKeyboardCommand(event(row, 'KeyX', true), 'timeline', {})).toBeUndefined()
    expect(videoEditKeyboardCommand(event(row, 'KeyZ', true), 'timeline', {})?.id).toBe('undo')
    for (const [code, command] of [['KeyL', 'play_forward'], ['Space', 'play_pause'], ['ArrowRight', 'step_forward'], ['KeyI', 'mark_in'], ['Home', 'go_start']]) {
      expect(videoEditKeyboardCommand(event(row, code), 'timeline', {})).toEqual({ id: command, scope: 'timeline' })
    }
  }
  // 焦点不在任何面板里才退回 activePanel
  expect(videoEditKeyboardCommand(event(document.createElement('div'), 'Delete'), 'timeline', {})).toEqual({ id: 'delete', scope: 'timeline' })
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
  for (const selector of ['input', 'textarea', 'select']) {
    const native = document.createElement(selector); source.append(native)
    expect(videoEditKeyboardCommand(event(native, 'Space'), 'timeline', {})).toBeUndefined()
  }
  // 同 PR：普通按钮获得焦点时空格仍是播放；开关类控件保留空格切换
  for (const node of [document.createElement('button'), Object.assign(document.createElement('div'), { role: 'button' })]) {
    source.append(node)
    expect(videoEditKeyboardCommand(event(node, 'Space'), 'timeline', {})?.id).toBe('play_pause')
  }
  const toggle = document.createElement('button'); toggle.setAttribute('role', 'switch'); source.append(toggle)
  expect(videoEditKeyboardCommand(event(toggle, 'Space'), 'timeline', {})).toBeUndefined()
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


it('Enter 只在时间线与节目监视器触发渲染，输入、文本编辑、菜单、已处理按键和输入法保持原行为', () => {
  for (const scope of ['timeline', 'program', 'source', 'effects', 'project', 'code_project', 'scenes']) {
    const panel = document.createElement('div'); panel.dataset.videoEditPanel = scope
    const picture = document.createElement('div'); panel.append(picture)
    expect(videoEditKeyboardCommand(event(picture, 'Enter'), 'timeline', {})).toEqual(['timeline', 'program'].includes(scope) ? { id: 'render_in_out', scope } : undefined)
    for (const kind of ['input', 'textarea', 'select', 'contenteditable', 'textbox', 'menu']) {
      const target = document.createElement(['input', 'textarea', 'select'].includes(kind) ? kind : 'div')
      if (kind === 'contenteditable') target.setAttribute('contenteditable', 'plaintext-only')
      if (kind === 'textbox' || kind === 'menu') target.setAttribute('role', kind)
      panel.append(target)
      expect(videoEditKeyboardCommand(event(target, 'Enter'), 'timeline', {})).toBeUndefined()
    }
    for (const blocked of [{ defaultPrevented: true }, { isComposing: true }, { repeat: true }]) expect(videoEditKeyboardCommand({ ...event(picture, 'Enter'), ...blocked }, 'timeline', {})).toBeUndefined()
  }
})
