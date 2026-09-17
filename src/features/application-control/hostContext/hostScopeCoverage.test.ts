// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createHostContextSnapshot } from './hostContext'

const memory = vi.hoisted(() => ({ content: '', enabled: true, revision: 1 }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ assistant: {
  getSharedMemory: async () => ({ ...memory }),
  updateSharedMemory: async (input: { content: string; expectedRevision: number }) => {
    if (input.expectedRevision !== memory.revision) throw new Error('conflict')
    memory.content = input.content
    memory.revision++
    return { ...memory }
  },
} }) }))
beforeEach(() => { memory.content = ''; memory.enabled = true; memory.revision = 1 })

it('公共调用从目标实体取得主进程版本，无需当前页面发布该作用域', async () => {
  const app = createApplicationHarness()
  const ref = { kind: 'assistant.shared_memory', id: 'singleton' }
  try {
    expect(createHostContextSnapshot().scopeRevisions).not.toHaveProperty('assistant_memory')
    const initial = await app.read(ref, ['assistant.shared_memory.content'])
    expect(initial.revisions).toEqual({ assistant_memory: 1 })
    const input = { summary: '更新共享偏好', changes: [{ kind: 'set_properties', entityType: ref.kind,
      target: ref, properties: { 'assistant.shared_memory.content': '偏好水墨' } }] }
    expect((await app.call('change_application_entities', input, { assistant_memory: 1 })).ok).toBe(true)
    expect(memory).toMatchObject({ content: '偏好水墨', revision: 2 })
    const stale = await app.call('change_application_entities', { ...input, changes: [{ ...input.changes[0],
      properties: { 'assistant.shared_memory.content': '过期请求' } }] }, { assistant_memory: 1 })
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error('过期版本未被拒绝')
    expect(stale.error?.code).toBe('CONFLICT')
    expect(memory).toMatchObject({ content: '偏好水墨', revision: 2 })
    expect((await app.change(ref, { 'assistant.shared_memory.content': '新的偏好' })).ok).toBe(true)
    expect(memory).toMatchObject({ content: '新的偏好', revision: 3 })
    const final = await app.read(ref, ['assistant.shared_memory.content'])
    expect(final.revisions).toEqual({ assistant_memory: 3 })
  } finally { app.dispose() }
})
