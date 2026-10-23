// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { emptyMemorySnapshot, type MemorySnapshot } from '@/core/assistant/memoryEntries'
import { applyMemoryWrite, type MemoryWrite } from '@/core/assistant/memoryOperations'
import type { ApplicationPlannedStep } from '@/core/application-control'
import { createMemoryRegistrations, MemoryExecutor } from './memoryReflection'
const fixture = vi.hoisted(() => ({ state: undefined as MemorySnapshot | undefined }))
vi.mock('@/services/assistantMemory/memoryService', () => ({
  refreshMemory: async () => fixture.state!,
  readMemory: async () => fixture.state!.settings.enabled ? fixture.state!.entries : [],
  writeMemory: async (input: MemoryWrite) => {
    if (!fixture.state!.settings.enabled) throw new Error('MEMORY_DISABLED')
    const result = applyMemoryWrite(fixture.state!.entries, input, new Date(), crypto.randomUUID())
    fixture.state!.entries = result.entries
    if (result.change) fixture.state!.history.push(result.change)
    return result.change
  }, revertMemory: vi.fn(),
}))
beforeEach(() => { fixture.state = emptyMemorySnapshot() })
const ref = { kind: 'assistant.memory', id: 'font' }
const input = { section: 'creative' as const, content: '中文使用思源黑体。', source: 'assistant' as const }
const provider = () => createMemoryRegistrations().find(value => value.entity.id === ref.kind)!.provider!
async function seed() {
  fixture.state!.entries = applyMemoryWrite([], { target: { layer: 'global' }, id: ref.id, expectedRevision: 0, actor: 'user', reason: '用户明确要求。', entry: input }, new Date(), 'seed').entries
  return provider().readEntity(ref, {})
}
function step(revisions: Record<string, number>): Extract<ApplicationPlannedStep, { kind: 'mutation' }> {
  return { kind: 'mutation', entityType: ref.kind, target: ref, expectedRevisions: revisions, mutations: [{ propertyId: 'assistant.memory.entry', operation: 'set', value: { ...input, content: '改为无衬线字体。' } }] }
}
it('三层记忆逐条修改，独立条目不互相覆盖', async () => {
  const before = await seed()
  fixture.state!.entries.push({ ...fixture.state!.entries[0], id: 'other', content: '视频使用横屏。' })
  await new MemoryExecutor('global').apply(step(before.revisions))
  expect(fixture.state!.entries.find(entry => entry.id === 'other')?.content).toBe('视频使用横屏。')
  expect(fixture.state!.entries.find(entry => entry.id === 'font')?.content).toBe('改为无衬线字体。')
})
it('关闭记忆后不允许保存', async () => {
  const before = await seed(); fixture.state!.settings.enabled = false
  await expect(new MemoryExecutor('global').apply(step(before.revisions))).rejects.toThrow()
  expect((await provider().listEntities({ limit: 10 })).refs).toEqual([])
})
it('过期或缺失条目基线拒绝覆盖，重读可合并', async () => {
  const before = await seed()
  fixture.state!.entries[0].revision++
  await expect(new MemoryExecutor('global').apply(step(before.revisions))).rejects.toThrow('CONFLICT')
  await expect(new MemoryExecutor('global').apply(step({ assistant_memory: 0 }))).rejects.toThrow('BASELINE_REQUIRED')
  await new MemoryExecutor('global').apply(step((await provider().readEntity(ref, {})).revisions))
  expect(fixture.state!.history).toHaveLength(1)
})
