import { expect, it } from 'vitest'
import { emptyMemorySnapshot, type MemoryEntry } from './memoryEntries'
import { memoryFontKey, resolveMemoryDefault } from './memoryDefaults'

it('关闭记忆时只保留风格，开启后项目偏好优先于全局与风格', () => {
  const state = emptyMemorySnapshot()
  const entry: MemoryEntry = { id: 'aspect', content: '横屏', source: 'user', revision: 1, updatedAt: '2026-10-24T00:00:00Z', value: { key: 'aspect', width: 16, height: 9 } }
  const style = { key: 'aspect' as const, width: 1, height: 1 }
  state.entries = [{ ...entry, section: 'creative' }]
  expect(resolveMemoryDefault('aspect', state, [], style)).toEqual({ value: style, askUser: true })
  const project = { ...entry, value: { key: 'aspect' as const, width: 9, height: 16 } }
  expect(resolveMemoryDefault('aspect', state, [project], style)).toEqual({ value: project.value, askUser: false })
  state.settings.enabled = false
  expect(resolveMemoryDefault('aspect', state, [project], style)).toEqual({ value: style, askUser: false })
  expect(resolveMemoryDefault('aspect', undefined, [project])).toEqual({ value: undefined, askUser: false })
})

it.each([['123.5%', 'font.numeric'], ['中文 English', 'font.zh'], ['', 'font.zh'], ['English', 'font.latin']])('文字 %s 选择 %s', (text, key) => {
  expect(memoryFontKey(text)).toBe(key)
})
