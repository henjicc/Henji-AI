// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { sha256HexString } from '@/utils/save/hash'
import { createHostContextSnapshot } from './hostContext'

beforeEach(() => { installHarnessNativeStorage() })
afterEach(() => { uninstallHarnessNativeStorage() })

it('公共调用从目标实体取得主进程版本，无需当前页面发布该作用域', async () => {
  const app = createApplicationHarness()
  const ref = { kind: 'assistant.memory', id: 'creative-preference' }
  const entry = { section: 'creative' as const, content: '偏好简洁', source: 'assistant' as const }
  const scope = `memory.${await sha256HexString(`${ref.kind}:${ref.id}`)}`
  try {
    await getPlatform().assistant.writeMemory({ target: { layer: 'global' }, id: ref.id, expectedRevision: 0,
      entry, actor: 'user', reason: '用户明确表达的创作偏好。' })
    const initialRevision = (await getPlatform().assistant.getMemoryState()).entries[0].revision
    expect(initialRevision).toBeGreaterThan(0)
    expect(createHostContextSnapshot().scopeRevisions).not.toHaveProperty('assistant_memory')
    expect(createHostContextSnapshot().scopeRevisions).not.toHaveProperty(scope)
    const initial = await app.read(ref, ['assistant.memory.entry'])
    expect(initial.revisions).toEqual({ assistant_memory: 0, [scope]: initialRevision })
    const input = { summary: '更新共享偏好', changes: [{ kind: 'set_properties', entityType: ref.kind,
      target: ref, properties: { 'assistant.memory.entry': { ...entry, content: '偏好水墨' } } }] }
    expect((await app.call('change_application_entities', input, { assistant_memory: 0, [scope]: initialRevision })).ok).toBe(true)
    const updated = (await getPlatform().assistant.getMemoryState()).entries
    expect(updated).toMatchObject([{ content: '偏好水墨' }])
    expect(updated[0].revision).toBeGreaterThan(initialRevision)
    const stale = await app.call('change_application_entities', { ...input, changes: [{ ...input.changes[0],
      properties: { 'assistant.memory.entry': { ...entry, content: '过期请求' } } }] }, { assistant_memory: 0, [scope]: initialRevision })
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error('过期版本未被拒绝')
    expect(stale.error?.code).toBe('CONFLICT')
    expect((await getPlatform().assistant.getMemoryState()).entries).toEqual(updated)
    expect((await app.change(ref, { 'assistant.memory.entry': { ...entry, content: '新的偏好' } })).ok).toBe(true)
    const saved = (await getPlatform().assistant.getMemoryState()).entries
    expect(saved).toMatchObject([{ content: '新的偏好' }])
    expect(saved[0].revision).toBeGreaterThan(updated[0].revision)
    const final = await app.read(ref, ['assistant.memory.entry'])
    expect(final.revisions).toEqual({ assistant_memory: 0, [scope]: saved[0].revision })
  } finally { app.dispose() }
})

it('记忆设置从主进程读取独立版本，过期设置写入不能覆盖新状态', async () => {
  const app = createApplicationHarness()
  const ref = { kind: 'assistant.memory_settings', id: 'singleton' }
  try {
    expect(createHostContextSnapshot().scopeRevisions).not.toHaveProperty('memory_settings')
    const initial = await app.read(ref, ['assistant.memory_settings.auto_organize'])
    expect(initial.revisions).toEqual({ memory_settings: 0 })
    expect((await app.change(ref, { 'assistant.memory_settings.auto_organize': false })).ok).toBe(true)
    const stale = await app.call('change_application_entities', { summary: '过期设置写入', changes: [{
      kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'assistant.memory_settings.auto_organize': true },
    }] }, { memory_settings: 0 })
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error('过期设置版本未被拒绝')
    expect(stale.error?.code).toBe('CONFLICT')
    expect(await getPlatform().assistant.getMemoryState()).toMatchObject({ settings: { autoOrganize: false }, revision: 1 })
    expect((await app.change(ref, { 'assistant.memory_settings.auto_organize': true })).ok).toBe(true)
    expect((await app.read(ref, ['assistant.memory_settings.auto_organize'])).revisions).toEqual({ memory_settings: 2 })
    expect(await getPlatform().assistant.getMemoryState()).toMatchObject({ settings: { autoOrganize: true }, revision: 2 })
  } finally { app.dispose() }
})
