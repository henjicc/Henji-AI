import { expect, it, vi } from 'vitest'
import type { ApplicationPlannedStep } from '@/core/application-control'
import { RecyclableCollectionExecutor } from './recyclableCollection'
import { restoreDeleted } from '@/services/recycle'

vi.mock('@/services/recycle', () => ({ restoreDeleted: vi.fn(), listDeleted: vi.fn() }))

it('同一配置的批量删除逆序撤销；中途恢复失败后重试只继续剩余快照', async () => {
  let providers = ['A', 'B']
  const backups = new Map<string, string[]>()
  const executor = new RecyclableCollectionExecutor('provider', {
    read: async ref => { if (!providers.includes(ref.id)) throw new Error('NOT_FOUND') },
    remove: async ref => { backups.set(ref.id, [...providers]); providers = providers.filter(id => id !== ref.id); return ref.id },
    revisions: () => ({ providers: 0 }),
  })
  const step = { kind: 'collection', parent: { kind: 'settings.registry', id: 'singleton' }, entityType: 'provider', operation: { kind: 'remove', targets: [{ kind: 'provider', id: 'A' }, { kind: 'provider', id: 'B' }] } } as Extract<ApplicationPlannedStep, { kind: 'collection' }>
  const result = await executor.apply(step)
  expect(providers).toEqual([])
  let fail = true
  vi.mocked(restoreDeleted).mockImplementation(async id => {
    if (id === 'A' && fail) { fail = false; throw new Error('文件占用') }
    const value = backups.get(id)
    if (!value) throw new Error('快照已恢复')
    providers = value; backups.delete(id)
  })
  await expect(executor.undo(result.undoToken!)).rejects.toThrow('文件占用')
  expect(providers).toEqual(['B'])
  const restored = await executor.undo(result.undoToken!)
  expect(restored.directRefs?.map(ref => ref.id)).toEqual(['A', 'B'])
  expect(providers).toEqual(['A', 'B'])
  expect(vi.mocked(restoreDeleted).mock.calls.map(call => call[0])).toEqual(['B', 'A', 'A'])
})

it('删除完成后的回读失败仍补偿回收项，不留下已删除却无撤销回执的内容', async () => {
  let exists = true
  vi.mocked(restoreDeleted).mockImplementation(async () => { exists = true })
  const executor = new RecyclableCollectionExecutor('record', {
    read: async () => ({ id: 'one' }),
    remove: async () => { exists = false; return 'backup' },
    revisions: async () => { throw new Error('索引读取失败') },
  })
  await expect(executor.apply({ kind: 'collection', parent: { kind: 'record', id: 'root' }, entityType: 'record',
    expectedRevisions: {}, operation: { kind: 'remove', targets: [{ kind: 'record', id: 'one' }] } })).rejects.toThrow('索引读取失败')
  expect(exists).toBe(true)
})
