import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { applicationReflectionHandlers } from '../applicationCapabilities/applicationReflectionAdapter'
const memory = vi.hoisted(() => ({ content: '', enabled: true, revision: 1 }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ assistant: {
  getSharedMemory: async () => ({ ...memory }),
  updateSharedMemory: async (input: { content: string; expectedRevision: number }) => {
    if (input.expectedRevision !== memory.revision) throw new Error('conflict')
    memory.content = input.content; memory.revision++; return { ...memory }
  },
} }) }))
beforeEach(() => { memory.content = ''; memory.enabled = true; memory.revision = 1 })
const ref = { kind: 'assistant.shared_memory', id: 'singleton' }
const context = () => ({ callerGrant: createApplicationCallerGrant({ callerId: 'external-agent', capabilityIds: ['change_application_entities'], permissions: ['application:write', 'settings:read', 'settings:write'], allowWrites: true, allowDestructive: false }), signal: new AbortController().signal, requestId: crypto.randomUUID(), expectedRevisions: { assistant_memory: memory.revision } })
async function change(content: string) {
  return applicationReflectionHandlers.changeEntities({ summary: '更新长期偏好', changes: [{ kind: 'set_properties', target: ref, entityType: ref.kind,
    properties: { 'assistant.shared_memory.content': content } }] }, context())
}
it('共享记忆通过正式通用事务保存和清空', async () => {
  await change('偏好水墨。')
  expect(memory.content).toBe('偏好水墨。')
  await change('')
  expect(memory.content).toBe('')
})
it('关闭记忆后通用事务不保存', async () => {
  memory.enabled = false
  await expect(change('不应写入')).rejects.toThrow()
  expect(memory.content).toBe('')
})
