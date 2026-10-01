import { expect, it } from 'vitest'
import { z } from 'zod'
import { matchVideoEditShortcut, parseVideoEditShortcutOverrides, VIDEO_EDIT_COMMANDS, videoEditCommandShortcut, videoEditShortcutLabel, videoEditShortcutOverridesSchema, type VideoEditKeyEvent } from './commands'

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
  const key = { code: 'KeyQ', ctrl: false, meta: false, alt: false, shift: false }
  const config = parseVideoEditShortcutOverrides({ select_tool: key, razor_tool: null })
  expect(matchVideoEditShortcut(event('KeyQ'), 'timeline', config)).toBe('select_tool')
  expect(videoEditCommandShortcut('razor_tool', config)).toBeUndefined()
  expect(() => parseVideoEditShortcutOverrides({ select_tool: { ...key, code: 'KeyC' } })).toThrow('冲突')
  expect(() => parseVideoEditShortcutOverrides({ select_tool: key, save: key })).toThrow('冲突')
  expect(() => parseVideoEditShortcutOverrides({ missing: key })).toThrow('不存在')
  expect(() => parseVideoEditShortcutOverrides({ select_tool: { ...key, unknown: true } })).toThrow()
  expect(videoEditShortcutLabel(videoEditCommandShortcut('save', {}))).toBe('Ctrl+S')
})
