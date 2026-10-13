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
