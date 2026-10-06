import { expect, it } from 'vitest'
import { z } from 'zod'
import { matchVideoEditShortcut, parseVideoEditShortcutOverrides, sanitizeVideoEditShortcutOverrides, VIDEO_EDIT_COMMANDS, videoEditCommandShortcut, videoEditCommandShortcuts, videoEditShortcutLabel, videoEditShortcutOverridesSchema, type VideoEditKeyEvent } from './commands'

const event = (code: string, values: Partial<VideoEditKeyEvent> = {}): VideoEditKeyEvent => ({ code, key: code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, ...values })
it('默认键位无冲突，工具限定时间线而播放作用于当前监视器', () => {
  expect(parseVideoEditShortcutOverrides({})).toEqual({})
  expect(new Set(VIDEO_EDIT_COMMANDS.map(command => command.id)).size).toBe(VIDEO_EDIT_COMMANDS.length)
  const schema = z.toJSONSchema(videoEditShortcutOverridesSchema)
  expect(schema.additionalProperties).toBe(false); expect(Object.keys(schema.properties ?? {})).toEqual(VIDEO_EDIT_COMMANDS.map(command => command.id)); expect(schema.required).toBeUndefined()
  expect(matchVideoEditShortcut(event('KeyV'), 'timeline', {})).toBe('select_tool')
  expect(matchVideoEditShortcut(event('KeyV'), 'source', {})).toBeUndefined()
  expect(matchVideoEditShortcut(event('Space'), 'source', {})).toBe('play_pause')
  expect(matchVideoEditShortcut(event('KeyK', { ctrlKey: true, shiftKey: true }), 'timeline', {})).toBe('split_tracks')
})
it('输入框、中文组合、已处理事件、错误修饰键与重复破坏性键不触发', () => {
  for (const guard of [{ isComposing: true }, { key: 'Process' }, { key: 'Unidentified' }, { defaultPrevented: true }, { altKey: true }, { repeat: true }]) expect(matchVideoEditShortcut(event('Delete', guard), 'timeline', {})).toBeUndefined()
  expect(matchVideoEditShortcut(event('Delete'), 'timeline', {}, true)).toBeUndefined()
  expect(matchVideoEditShortcut(event('ArrowRight', { repeat: true }), 'program', {})).toBe('step_forward')
  expect(matchVideoEditShortcut(event('KeyS', { ctrlKey: true, altKey: true }), 'timeline', {})).toBeUndefined()
})
it('自定义键位按作用域检查默认及覆盖冲突，禁用与恢复默认明确', () => {
  const key = { code: 'F9', ctrl: false, meta: false, alt: false, shift: false }
  const config = parseVideoEditShortcutOverrides({ select_tool: key, razor_tool: null })
  expect(matchVideoEditShortcut(event('F9'), 'timeline', config)).toBe('select_tool')
  expect(videoEditCommandShortcut('razor_tool', config)).toBeUndefined()
  expect(() => parseVideoEditShortcutOverrides({ select_tool: { ...key, code: 'KeyC' } })).toThrow('冲突')
  expect(() => parseVideoEditShortcutOverrides({ select_tool: key, save: key })).toThrow('冲突')
  expect(() => parseVideoEditShortcutOverrides({ missing: key })).toThrow('不存在')
  expect(() => parseVideoEditShortcutOverrides({ select_tool: { ...key, unknown: true } })).toThrow()
  expect(videoEditShortcutLabel(videoEditCommandShortcut('save', {}))).toBe('Ctrl+S')
})
it('默认键位与 Premiere Pro（Windows）默认表一致，第二组默认键同样生效', () => {
  const expectations: Array<[string, Partial<VideoEditKeyEvent>, Parameters<typeof matchVideoEditShortcut>[1], string]> = [
    ['ArrowUp', {}, 'timeline', 'go_prev_edit'], ['ArrowDown', { shiftKey: true }, 'timeline', 'go_next_edit_any'], ['Home', {}, 'program', 'go_start'],
    ['KeyI', { shiftKey: true }, 'timeline', 'go_in'], ['KeyX', { ctrlKey: true, shiftKey: true }, 'source', 'clear_in_out'], ['KeyX', {}, 'timeline', 'mark_clip'],
    ['KeyM', {}, 'timeline', 'add_marker'], ['KeyM', { ctrlKey: true, shiftKey: true }, 'timeline', 'prev_marker'], ['Semicolon', {}, 'timeline', 'lift'], ['Quote', {}, 'timeline', 'extract'],
    ['KeyQ', {}, 'timeline', 'ripple_trim_prev'], ['KeyW', {}, 'timeline', 'ripple_trim_next'], ['KeyL', { ctrlKey: true }, 'timeline', 'toggle_link'], ['KeyG', { ctrlKey: true, shiftKey: true }, 'timeline', 'ungroup'],
    ['KeyX', { ctrlKey: true }, 'timeline', 'cut'], ['KeyA', { ctrlKey: true, shiftKey: true }, 'project', 'deselect_all'], ['ArrowLeft', { altKey: true, shiftKey: true }, 'timeline', 'nudge_left_five'],
    ['Digit3', { shiftKey: true }, 'source', 'focus_timeline'], ['Backquote', {}, 'project', 'maximize_panel'], ['Backslash', {}, 'timeline', 'zoom_to_sequence'], ['KeyB', { ctrlKey: true }, 'project', 'new_bin'],
    ['KeyO', { shiftKey: true }, 'project', 'open_in_source'], ['PageUp', { ctrlKey: true }, 'project', 'project_list_view'], ['Backspace', {}, 'timeline', 'delete'], ['Backspace', { altKey: true }, 'timeline', 'ripple_delete'],
  ]
  for (const [code, modifiers, scope, id] of expectations) expect(matchVideoEditShortcut(event(code, modifiers), scope, {}), `${code} ${JSON.stringify(modifiers)} @${scope}`).toBe(id)
  expect(videoEditCommandShortcuts('delete', {}).map(videoEditShortcutLabel)).toEqual(['Delete', 'Backspace'])
  // 改键后只保留用户的键
  const config = parseVideoEditShortcutOverrides({ delete: { code: 'F9', ctrl: false, meta: false, alt: false, shift: false } })
  expect(matchVideoEditShortcut(event('Backspace'), 'timeline', config)).toBeUndefined()
  expect(videoEditShortcutLabel(videoEditCommandShortcut('zoom_to_sequence', {}))).toBe('\\')
})
it('恢复已保存改键：丢弃无效项，与新默认冲突时保留用户键并让出默认键', () => {
  const ctrlL = { code: 'KeyL', ctrl: true, meta: false, alt: false, shift: false }
  expect(() => parseVideoEditShortcutOverrides({ link: ctrlL })).toThrow('冲突')
  const restored = sanitizeVideoEditShortcutOverrides({ link: ctrlL, missing: ctrlL, save: { code: 'Nope' }, razor_tool: null })
  expect(restored).toEqual({ link: ctrlL, toggle_link: null, razor_tool: null })
  expect(parseVideoEditShortcutOverrides(restored)).toEqual(restored)
  expect(sanitizeVideoEditShortcutOverrides('bad')).toEqual({})
})
