// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'

import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import type { MediaCacheCategory } from '@/core/media/mediaCache'

import { applicationReflectionHandlers } from '../../application-control/capabilities/applicationReflectionAdapter'

/** 假的主进程缓存服务：真相源只有这里，断言一律从它读。 */
const fake = vi.hoisted(() => ({ bytes: {} as Record<string, number>, cleared: [] as string[] }))
vi.mock('@/platform/runtime', async (original) => ({ ...await original<object>(), getPlatform: () => ({ mediaCache: {
  usage: async () => ({ categories: Object.entries(fake.bytes).map(([category, bytes]) => ({ category, bytes, files: bytes ? 1 : 0 })), totalBytes: 0, budgetBytes: 0, autoBudgetBytes: 0 }),
  clear: async (category: MediaCacheCategory | 'all') => {
    fake.cleared.push(category)
    const keys = category === 'all' ? Object.keys(fake.bytes) : [category]
    const removed = keys.filter(key => fake.bytes[key]).length
    for (const key of keys) fake.bytes[key] = 0
    return { removedFiles: removed, removedBytes: 0, skippedFiles: 0 }
  },
} }) }))

beforeEach(() => { fake.bytes = { render: 100, proxy: 200, analysis: 0, preview: 5, audio_edit: 0 }; fake.cleared = [] })

const context = () => ({ callerGrant: createApplicationCallerGrant({ callerId: 'external-agent' }), signal: new AbortController().signal, requestId: crypto.randomUUID(), expectedRevisions: {} })
const parent = { kind: 'settings.registry', id: 'singleton' }
const ref = (id: string) => ({ kind: 'settings.media_cache', id })

it('通过通用 change 移除一类缓存即清除它，缓存服务清空、列表里不再有它，其他类不动', async () => {
  await applicationReflectionHandlers.changeEntities({ summary: '清除预渲染缓存', changes: [{ kind: 'remove_items', entityType: 'settings.media_cache', parent, targets: [ref('render')] }] }, context())
  expect(fake.cleared).toEqual(['render'])
  expect(fake.bytes).toMatchObject({ render: 0, proxy: 200 })
  expect((await applicationReflectionHandlers.listEntities({ entityType: 'settings.media_cache', limit: 20 }, context())).refs.map(item => item.id)).toEqual(['proxy', 'preview'])
})

it('移除全部类别走一次全部清除', async () => {
  const listed = await applicationReflectionHandlers.listEntities({ entityType: 'settings.media_cache', limit: 20 }, context())
  await applicationReflectionHandlers.changeEntities({ summary: '清除全部缓存', changes: [{ kind: 'remove_items', entityType: 'settings.media_cache', parent, targets: listed.refs.map(item => ({ kind: item.kind, id: item.id })) }] }, context())
  expect(fake.cleared).toEqual(['all'])
  expect(Object.values(fake.bytes).every(value => value === 0)).toBe(true)
})
