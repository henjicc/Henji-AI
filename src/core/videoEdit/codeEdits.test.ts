import { expect, it } from 'vitest'
import { codeEditKey, codeElementEdits, dropCodeElementEdits, recordVideoEditCodeEdits } from './codeEdits'
import type { VideoEditClip } from './document'

it('元素 id 含冒号且是另一个 id 的前缀时，读取与并入源码后的删除都只认自己的记录', () => {
  const before = {} as VideoEditClip
  const after = { elementOverrides: { a: { dx: 1 }, 'a:b': { dx: 2, effects: { 'k:1': { enabled: false } } } } } as unknown as VideoEditClip
  recordVideoEditCodeEdits(before, after, 'user', [], 1)
  expect(Object.keys(after.edits!).sort()).toEqual([codeEditKey.element('a', 'dx'), codeEditKey.element('a:b', 'dx'), codeEditKey.effect('a:b', 'k:1', 'enabled')].sort())
  expect(Object.keys(codeElementEdits(after.edits, 'a', []))).toEqual([codeEditKey.element('a', 'dx')])
  expect(Object.keys(codeElementEdits(after.edits, 'a:b', [])).sort()).toEqual([codeEditKey.element('a:b', 'dx'), codeEditKey.effect('a:b', 'k:1', 'enabled')].sort())
  dropCodeElementEdits(after, ['a'])
  expect(Object.keys(after.edits!).sort()).toEqual([codeEditKey.element('a:b', 'dx'), codeEditKey.effect('a:b', 'k:1', 'enabled')].sort())
  // 常见名字不转义，键仍可直接读。
  expect(codeEditKey.effect('title', 'glow#2', 'strength')).toBe('element:title:effect:glow#2:strength')
})
