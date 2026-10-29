import { describe, expect, it } from 'vitest'
import { globalMemoryEntriesSchema, projectMemoryEntriesSchema, resolveMemoryValue, firstAvailableMemoryFont, shouldOrganizeMemory, type MemoryEntry } from './memoryEntries'
import { applyMemoryWrite, memoryRevertWrite, type MemoryWrite } from './memoryOperations'
import { buildProjectManifest, parseProjectManifest } from '../documents/projectManifest'

const now = new Date('2026-10-23T00:00:00Z')
const write: MemoryWrite = { target: { layer: 'global' }, id: 'font', expectedRevision: 0, actor: 'assistant', reason: '用户明确指定默认字体。', entry: { section: 'creative', content: '中文默认思源黑体。', source: 'assistant', value: { key: 'font.zh', fonts: ['思源黑体', '微软雅黑'] } } }
const entry = (): MemoryEntry => applyMemoryWrite([], write, now, 'first').entries[0]

describe('三层记忆契约与写入', () => {
  it('全局必须分区，项目不允许分区或优先级，容量与重复标识校验', () => {
    expect(globalMemoryEntriesSchema.safeParse([entry()]).success).toBe(true)
    expect(projectMemoryEntriesSchema.safeParse([entry()]).success).toBe(false)
    const { section: _section, ...local } = entry()
    expect(projectMemoryEntriesSchema.safeParse([local]).success).toBe(true)
    expect(projectMemoryEntriesSchema.safeParse([{ ...local, precedence: 'preference' }]).success).toBe(false)
    expect(globalMemoryEntriesSchema.safeParse([entry(), entry()]).success).toBe(false)
    expect(globalMemoryEntriesSchema.safeParse(Array.from({ length: 20 }, (_, i) => ({ ...entry(), id: String(i), content: '字'.repeat(200) }))).success).toBe(false)
  })
  it('同条目拒绝陈旧基线，不同条目不互相阻断，空改动不记历史', () => {
    const first = applyMemoryWrite([], write, now, 'first')
    expect(() => applyMemoryWrite(first.entries, write, now, 'second')).toThrow('CONFLICT')
    expect(applyMemoryWrite(first.entries, { ...write, id: 'second' }, now, 'second').entries).toHaveLength(2)
    expect(applyMemoryWrite(first.entries, { ...write, expectedRevision: first.entries[0].revision }, now, 'same').change).toBeNull()
  })
  it('撤回新增、修改、删除，并拒绝覆盖后续编辑', () => {
    const first = applyMemoryWrite([], write, now, 'first')
    const revert = memoryRevertWrite(first.change!, first.entries, 'user')
    const deleted = applyMemoryWrite(first.entries, revert, now, 'delete')
    expect(deleted.entries).toEqual([])
    const restored = applyMemoryWrite([], memoryRevertWrite(deleted.change!, [], 'user'), now, 'restore')
    expect(restored.entries[0].content).toBe(entry().content)
    expect(() => memoryRevertWrite(first.change!, restored.entries, 'user')).toThrow('CONFLICT')
  })
  it('所有写入拒绝凭据与多行长文本', () => {
    for (const content of ['sk-abcdefghijklmnopqrstuv123456', '完整日志如下', '一句\n两句', '长'.repeat(201)]) {
      expect(() => applyMemoryWrite([], { ...write, entry: { ...write.entry!, content } }, now, 'bad')).toThrow()
    }
  })
  it('项目优先、偏好显式覆盖风格，未决定冲突必须询问', () => {
    const global = entry()
    const style = { key: 'font.zh' as const, fonts: ['宋体'] }
    expect(resolveMemoryValue('font.zh', [global], [], style)).toEqual({ value: style, askUser: true })
    expect(resolveMemoryValue('font.zh', [{ ...global, precedence: 'preference' }], [], style)).toEqual({ value: global.value, askUser: false })
    expect(resolveMemoryValue('font.zh', [global], [{ ...global, value: { key: 'font.zh', fonts: ['项目字体'] } }], style).value).toEqual({ key: 'font.zh', fonts: ['项目字体'] })
    expect(firstAvailableMemoryFont(['缺失', 'source han sans'], ['Source Han Sans'])).toBe('Source Han Sans')
  })
  it('整理只在启用且十次改动或容量触发，每日最多一次', () => {
    const state = { settings: { enabled: true, autoOrganize: true }, changesSinceOrganization: 9, lastOrganizedAt: null }
    expect(shouldOrganizeMemory(state, now)).toBe(false)
    expect(shouldOrganizeMemory(state, now, true)).toBe(true)
    expect(shouldOrganizeMemory({ ...state, needsOrganization: true }, now)).toBe(true)
    expect(shouldOrganizeMemory({ ...state, settings: { enabled: true, autoOrganize: false } }, now, true)).toBe(false)
    expect(shouldOrganizeMemory({ ...state, changesSinceOrganization: 10 }, now)).toBe(true)
    expect(shouldOrganizeMemory({ ...state, changesSinceOrganization: 10, lastOrganizedAt: now.toISOString() }, now)).toBe(false)
    expect(shouldOrganizeMemory({ ...state, settings: { enabled: false, autoOrganize: true } }, now, true)).toBe(false)
  })
  it('项目格式升级保留原字段，保存和读回保留项目记忆', () => {
    const base = buildProjectManifest({ id: 'golden-project', locale: 'zh', createdAt: now.toISOString(), draft: false })
    expect(parseProjectManifest({ ...base, version: 1 })).toEqual(base)
    const { section: _section, ...memory } = entry()
    const manifest = buildProjectManifest({ ...base, draft: false, memories: [memory] })
    expect(parseProjectManifest(manifest).memories).toEqual([memory])
    expect(manifest.minReaderVersion).toBe(1)
  })
})
