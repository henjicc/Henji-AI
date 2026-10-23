// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { refreshMemory } from '../memory/memoryService'
const root = { kind: 'assistant.memory_settings', id: 'singleton' }
beforeEach(() => installHarnessNativeStorage())
afterEach(() => uninstallHarnessNativeStorage())
it('通用集合创建、条目修改、算法撤回经正式权限与验证链闭环', async () => {
  const app = createApplicationHarness()
  try {
    const created = await app.requireResult('change_application_entities', { summary: '记录明确偏好', changes: [{ kind: 'create_items', entityType: 'assistant.memory', parent: root, items: [{ properties: { 'assistant.memory.entry': { section: 'creative', content: '中文默认思源黑体。', source: 'assistant', value: { key: 'font.zh', fonts: ['思源黑体'] } } } }] }] })
    const ref = (created.resultRefs as Array<{kind: string; id: string}>).find(value => value.kind === 'assistant.memory')!
    expect(ref).toBeDefined()
    const entry = { section: 'creative', content: '以后中文都用无衬线字体。', source: 'assistant' }
    const result = await app.change(ref, { 'assistant.memory.entry': entry })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    const saved = await refreshMemory()
    expect(saved.entries[0].content).toBe(entry.content)
    await app.requireResult('revert_assistant_memory', { historyId: saved.history.at(-1)!.id })
    const undone = await refreshMemory()
    expect(undone.entries[0].content).toBe('中文默认思源黑体。')
    expect(undone.history.at(-1)?.reverts).toBe(saved.history.at(-1)?.id)
    expect((await app.change(root, { 'assistant.memory_settings.enabled': false })).ok).toBe(true)
    expect((await refreshMemory()).entries).toEqual([])
    expect((await app.call('change_application_entities', { summary: '关闭时拒绝新增', changes: [{ kind: 'create_items', entityType: 'assistant.memory', parent: root, items: [{ properties: { 'assistant.memory.entry': entry } }] }] })).ok).toBe(false)
  } finally { app.dispose() }
})
