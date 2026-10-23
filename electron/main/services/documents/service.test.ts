import { expect, it, vi } from 'vitest'
import { createTestEnvironment } from './documents.test-support'

it('全量列表在封面冷加载期间更新排序仍包含读取快照的全部文档', async () => {
  const env = createTestEnvironment()
  try {
    const doc = await env.services.service.createDocument({ kind: 'canvas', name: '模板', container: { kind: 'user' } })
    const template = env.catalog.getDocument(doc.meta.id)!
    env.catalog.removeDocument(doc.meta.id)
    for (let index = 0; index < 105; index++) {
      env.catalog.upsertDocument({ ...template, id: `doc-${index}`, name: `${index}`, path: `${doc.meta.path}-${index}`, updatedAt: 1000 - index })
    }
    vi.spyOn(env.services.covers, 'getMany').mockImplementationOnce(async () => {
      const last = env.catalog.getDocument('doc-104')!
      env.catalog.upsertDocument({ ...last, updatedAt: 2000 })
      return new Map()
    })
    const items = await env.services.service.listDocuments()
    expect(new Set(items.map(item => item.id)).size).toBe(105)
    expect(items.find(item => item.id === 'doc-104')?.updatedAt).toBe(896)
  } finally { vi.restoreAllMocks(); await env.cleanup() }
})


it('项目记忆在项目锁内核对条目基线，历史失败回滚文件，不串入其他项目', async () => {
  const env = createTestEnvironment()
  try {
    const first = await env.services.service.createProject({ name: '第一期' })
    const second = await env.services.service.createProject({ name: '第二期' })
    const service = env.services.service
    const input = { target: { layer: 'project' as const, ownerId: first.id }, id: 'brand', expectedRevision: 0, actor: 'assistant' as const, reason: '本期品牌要求。', entry: { content: '这期品牌色使用红色。', source: 'assistant' as const } }
    const commit = vi.fn()
    const results = await Promise.allSettled([service.writeProjectMemory(input, () => undefined, commit), service.writeProjectMemory(input, () => undefined, commit)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(commit).toHaveBeenCalledOnce()
    expect((await service.readProjectMemory(first.id))[0].content).toBe(input.entry.content)
    expect(await service.readProjectMemory(second.id)).toEqual([])
    const saved = await service.readProjectMemory(first.id)
    await expect(service.writeProjectMemory({ ...input, expectedRevision: saved[0].revision, entry: { ...input.entry, content: '蓝色。' } }, () => undefined, () => { throw new Error('历史写入失败') })).rejects.toThrow('历史写入失败')
    expect(await service.readProjectMemory(first.id)).toEqual(saved)
  } finally { await env.cleanup() }
})
