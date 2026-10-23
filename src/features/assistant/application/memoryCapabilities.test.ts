import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { executeApplicationCapabilityResult } from '@/features/application-control/capabilities/registry'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { videoEditStyleLibrary } from '@/features/videoEdit/application/videoEditStyleLibrary'
import { refreshMemory } from '@/services/assistantMemory/memoryService'
const root = { kind: 'assistant.memory_settings', id: 'singleton' }
beforeEach(() => installHarnessNativeStorage())
afterEach(() => { uninstallHarnessNativeStorage(); vi.restoreAllMocks() })
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
    expect(saved.entries[0].precedence).toBeUndefined()
    await app.requireResult('revert_assistant_memory', { historyId: saved.history.at(-1)!.id })
    const undone = await refreshMemory()
    expect(undone.entries[0].content).toBe('中文默认思源黑体。')
    expect(undone.history.at(-1)?.reverts).toBe(saved.history.at(-1)?.id)
    expect((await app.change(root, { 'assistant.memory_settings.enabled': false })).ok).toBe(true)
    expect((await refreshMemory()).entries).toEqual([])
    expect((await app.call('change_application_entities', { summary: '关闭时拒绝新增', changes: [{ kind: 'create_items', entityType: 'assistant.memory', parent: root, items: [{ properties: { 'assistant.memory.entry': entry } }] }] })).ok).toBe(false)
  } finally { app.dispose() }
})

it('整理在参数/内容校验失败后可纠正重试，整批预检不留下早先条目的写入', async () => {
  // 此夹具没有风格；只替换风格文件枚举边界，记忆预检、写入和历史使用正式实现。
  vi.spyOn(videoEditStyleLibrary, 'ready').mockResolvedValue()
  vi.spyOn(videoEditStyleLibrary, 'listStyles').mockReturnValue([])
  const app = createApplicationHarness()
  const valid = { target: { layer: 'global' }, id: 'first', expectedRevision: 0, entry: { section: 'creative', content: '正文用思源黑体，别用宋体。', source: 'assistant' }, actor: 'assistant', reason: '用户明确表达偏好。' }
  try {
    for (const bad of [
      { ...valid, target: { layer: 'project', ownerId: 'project' } },
      { ...valid, expectedRevision: undefined },
    ]) {
      expect(await app.call('organize_assistant_memory', { changes: [bad] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', details: { execution: { notExecuted: true } } } })
    }
    // 冲突是业务准备阶段的拒绝；前面的有效建议也不能已落盘。
    const rejected = await app.call('organize_assistant_memory', { changes: [valid, { ...valid, id: 'second', expectedRevision: 9 }] })
    expect(rejected).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
    expect((await refreshMemory()).entries).toHaveLength(0)
    await app.requireResult('organize_assistant_memory', { changes: [valid] })
    const saved = await refreshMemory()
    expect(saved.entries).toHaveLength(1)
    expect(saved.entries[0].precedence).toBeUndefined()
  } finally { app.dispose() }
})

it('真实授权信封：父基线可新增，条目基线可删除/撤销，旧条目基线不能删除新内容', async () => {
  const app = createApplicationHarness()
  const callerGrant = createApplicationCallerGrant({ callerId: 'memory-public-test', capabilityIds: ['change_application_entities', 'undo_application_changes'], permissions: ['application:write', 'application:read', 'settings:write', 'settings:read'], allowWrites: true, allowDestructive: true })
  const call = (id: string, input: Record<string, unknown>, expectedRevisions?: Record<string, number>) => executeApplicationCapabilityResult({ id, version: BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)!.version, input, expectedRevisions }, { callerGrant, requestId: crypto.randomUUID(), signal: new AbortController().signal })
  const content = { section: 'creative', content: '中文默认思源黑体。', source: 'assistant' }
  try {
    const parent = await app.read(root)
    const created = await call('change_application_entities', { summary: '新增偏好', changes: [{ kind: 'create_items', entityType: 'assistant.memory', parent: root, items: [{ properties: { entry: content } }] }] }, parent.revisions as Record<string, number>)
    expect(created.ok, JSON.stringify(created)).toBe(true)
    if (!created.ok) return
    const ref = (created.data.resultRefs as Array<{ kind: string; id: string }>)[0]
    const before = await app.read(ref)
    const remove = { summary: '删除测试偏好', changes: [{ kind: 'remove_items', entityType: ref.kind, parent: root, targets: [ref] }] }
    const deleted = await call('change_application_entities', remove, before.revisions as Record<string, number>)
    expect(deleted.ok, JSON.stringify(deleted)).toBe(true)
    if (!deleted.ok) return
    expect((await refreshMemory()).entries).toEqual([])
    const restored = await call('undo_application_changes', { undoRef: deleted.data.undoRef })
    expect(restored.ok, JSON.stringify(restored)).toBe(true)
    expect((await refreshMemory()).entries[0]?.content).toBe(content.content)
    // 撤销后有新修订；原条目基线不能再删掉恢复后的内容。
    const stale = await call('change_application_entities', remove, before.revisions as Record<string, number>)
    expect(stale.ok).toBe(false)
    expect((await refreshMemory()).entries).toHaveLength(1)
  } finally { app.dispose() }
})
