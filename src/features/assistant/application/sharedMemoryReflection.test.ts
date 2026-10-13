import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { applicationReflectionHandlers } from '../../application-control/capabilities/applicationReflectionAdapter'
import { SharedMemoryExecutor } from './sharedMemoryReflection'
import type { ApplicationPlannedStep } from '@/core/application-control'
const memory = vi.hoisted(() => ({ content: '', enabled: true, revision: 1 }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => false, getPlatform: () => ({ assistant: {
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
it('执行器不能用再次读取到的新版本替换计划中的旧基线', async () => {
  memory.content = '其他人刚保存的偏好'; memory.revision = 2
  const step = { kind: 'mutation', target: ref, entityType: ref.kind, expectedRevisions: { assistant_memory: 1 },
    mutations: [{ propertyId: 'assistant.shared_memory.content', operation: 'set', value: '旧文本合并结果' }] } as Extract<ApplicationPlannedStep, { kind: 'mutation' }>
  await expect(new SharedMemoryExecutor().apply(step)).rejects.toThrow('conflict')
  expect(memory).toMatchObject({ content: '其他人刚保存的偏好', revision: 2 })
})

it('执行器拒绝缺少读取基线的计划', async () => {
  memory.content = '用户已有偏好'
  const step = { kind: 'mutation', target: ref, entityType: ref.kind, expectedRevisions: {},
    mutations: [{ propertyId: 'assistant.shared_memory.content', operation: 'set', value: '覆盖内容' }] } as Extract<ApplicationPlannedStep, { kind: 'mutation' }>
  await expect(new SharedMemoryExecutor().apply(step)).rejects.toThrow('BASELINE_REQUIRED')
  expect(memory).toMatchObject({ content: '用户已有偏好', revision: 1 })
})

it.each<Record<string, number> | undefined>([undefined, {}, { unrelated: 1 }])('共享记忆自动模式或不完整基线不允许覆盖期间他人的修改：%j', async (expectedRevisions) => {
  const oldContent = memory.content
  memory.content = '用户刚保存的新偏好'; memory.revision = 2
  await expect(applicationReflectionHandlers.changeEntities({ summary: '合并偏好', changes: [{ kind: 'set_properties',
    target: ref, entityType: ref.kind, properties: { content: `${oldContent}旧内容合并` } }] }, { ...context(), expectedRevisions }))
    .rejects.toThrow('BASELINE_REQUIRED')
  expect(memory).toMatchObject({ content: '用户刚保存的新偏好', revision: 2 })
})

it('过期读取基线拒绝写入，重新读取后合并可成功', async () => {
  const stale = context()
  memory.content = '其他调用者的偏好'; memory.revision = 2
  const input = { summary: '合并偏好', changes: [{ kind: 'set_properties' as const, target: ref, entityType: ref.kind,
    properties: { content: '旧合并内容' } }] }
  await expect(applicationReflectionHandlers.changeEntities(input, stale)).rejects.toThrow(/CONFLICT/)
  expect(memory.content).toBe('其他调用者的偏好')
  await change(`${memory.content}；我新增的偏好`)
  expect(memory).toMatchObject({ content: '其他调用者的偏好；我新增的偏好', revision: 3 })
})
