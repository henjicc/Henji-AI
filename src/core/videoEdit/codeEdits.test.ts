import { expect, it } from 'vitest'
import { CODE_EDIT_CHECK_KEY, codeEditKey, codeElementEdits, dropCodeElementEdits, markCodeEditsChecked, pendingUserCodeEdits, recordVideoEditCodeEdits } from './codeEdits'
import type { VideoEditClip } from './document'
import { migrateVideoEditCodeEditChecks } from './codeEditCheckMigration'

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

it('旧作品打开时已有的手改记为检查过，之后的手改才待检查', () => {
  const content = { sequences: [{ clips: [{ id: 'a', edits: { 'param:x': { by: 'user', at: 5 }, 'param:y': { by: 'assistant', at: 9 } } }, { id: 'b' }, { id: 'c', edits: { check: { by: 'assistant', at: 1 } } }] }] }
  const [a, b, c] = (migrateVideoEditCodeEditChecks(content) as typeof content).sequences[0].clips as VideoEditClip[]
  expect(a.edits?.[CODE_EDIT_CHECK_KEY]).toEqual({ by: 'assistant', at: 9 }); expect(pendingUserCodeEdits(a.edits)).toEqual([])
  expect(b.edits).toBeUndefined(); expect(c.edits).toEqual({ check: { by: 'assistant', at: 1 } })
  expect(content.sequences[0].clips[0].edits).not.toHaveProperty('check')
})
it('助手检查之后用户再手改的才待检查；检查记录不随参数改动或并入源码丢失', () => {
  const clip = { code: { parameters: { title: '甲' } } } as unknown as VideoEditClip
  recordVideoEditCodeEdits({ code: { parameters: {} } } as unknown as VideoEditClip, clip, 'user', [], 10)
  expect(pendingUserCodeEdits(clip.edits).map(([key]) => key)).toEqual([codeEditKey.param('title')])
  clip.edits = markCodeEditsChecked(clip.edits, 20)
  expect(pendingUserCodeEdits(clip.edits)).toEqual([])
  const next = { ...clip, code: { parameters: { title: '乙', color: [1, 0, 0, 1] } } } as unknown as VideoEditClip
  recordVideoEditCodeEdits(clip, next, 'assistant', [], 30)
  expect(pendingUserCodeEdits(next.edits)).toEqual([])
  const typed = { ...next, code: { parameters: { title: '丙', color: [1, 0, 0, 1] } } } as unknown as VideoEditClip
  recordVideoEditCodeEdits(next, typed, 'user', [], 40)
  expect(pendingUserCodeEdits(typed.edits).map(([key]) => key)).toEqual([codeEditKey.param('title')])
  // 同一次写入里刚标记的检查保留，不被按改动前的记录重算覆盖。
  const marked = { ...typed, edits: markCodeEditsChecked(typed.edits, 50), code: { parameters: { title: '丁', color: [1, 0, 0, 1] } } } as unknown as VideoEditClip
  recordVideoEditCodeEdits(typed, marked, 'assistant', [], 50)
  expect(marked.edits![CODE_EDIT_CHECK_KEY]).toEqual({ by: 'assistant', at: 50 })
  dropCodeElementEdits(marked, ['x'])
  expect(marked.edits![CODE_EDIT_CHECK_KEY]).toEqual({ by: 'assistant', at: 50 })
})
