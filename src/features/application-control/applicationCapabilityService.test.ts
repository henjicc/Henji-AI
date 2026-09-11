// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApplicationCallerGrant, revokeApplicationCallerGrant } from '@/core/application-control/callerContext'
import { useSettingsStore } from '@/stores/settingsStore'
import { getSettingsRegistryRevision } from '@/features/settings/application-control/settingsApplicationService'
import { getApplicationReflectionRegistry } from '@/features/assistant/applicationCapabilities/applicationControlRegistry'
import { retainHostContextTracking } from '@/features/assistant/hostContext/hostContext'
import { executeApplicationCapabilityResult } from '@/features/assistant/applicationCapabilities/registry'
import { createApplicationCapabilitySession, listApplicationCapabilities } from './applicationCapabilityService'

const originalTone = useSettingsStore.getState().themeTonePreset
afterEach(() => useSettingsStore.getState().setThemeTonePreset(originalTone))

function grant(permissions = ['application:read', 'settings:read'], writes = false) {
  return createApplicationCallerGrant({
    callerId: 'local-test', permissions, allowWrites: writes, allowDestructive: false,
    capabilityIds: listApplicationCapabilities().map((value) => value.id),
  })
}
const request = (requestId: string) => ({ requestId, signal: new AbortController().signal })
const read = { id: 'read_application_entity', version: 1, input: {
  ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: ['interface.theme_tone'],
} }
const write = (value: string) => ({ id: 'change_application_entities', version: 2,
  expectedRevisions: { settings: getSettingsRegistryRevision() }, input: {
    summary: '改变色调', changes: [{ kind: 'set_properties', entityType: 'settings.registry',
      target: { kind: 'settings.registry', id: 'singleton' }, properties: { 'interface.theme_tone': value } }],
  } })

describe('独立应用调用入口', () => {
  it('不需要助手运行或脚本即可通过正式注册表读取', async () => {
    const result = await createApplicationCapabilitySession(grant()).execute(read, request('read'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.properties).toEqual({ 'interface.theme_tone': originalTone })
  })

  it('有权内存事务经原执行器写入，再从正式状态读回', async () => {
    const dispose = retainHostContextTracking()
    try {
      const session = createApplicationCapabilitySession(grant(['application:read', 'application:write', 'settings:read', 'settings:write'], true))
      const target = originalTone === 'warm' ? 'cool' : 'warm'
      const result = await session.execute(write(target), request('write-tone'))
      expect(result.ok, JSON.stringify(result)).toBe(true)
      expect(useSettingsStore.getState().themeTonePreset).toBe(target)
      const readback = await session.execute(read, request('read-after'))
      expect(readback.ok).toBe(true)
      if (readback.ok) expect(readback.data.properties).toEqual({ 'interface.theme_tone': target })
    } finally { dispose() }
  })

  it('只读授权拒绝写入；工具参数不能伪造权限', async () => {
    const session = createApplicationCapabilitySession(grant())
    await expect(session.execute(write('warm'), request('deny-write'))).rejects.toThrow(/application:write.*应用/)
    await expect(session.execute({ ...read, callerGrant: grant(['application:write'], true) }, request('forge'))).rejects.toThrow()
    expect(useSettingsStore.getState().themeTonePreset).toBe(originalTone)
  })

  it('有能力写权限但缺少属性权限时由事务内核再次拒绝', async () => {
    const session = createApplicationCapabilitySession(grant(['application:read', 'application:write', 'settings:read'], true))
    const result = await session.execute(write('warm'), request('deny-property'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(/PERMISSION_DENIED|权限/)
    expect(useSettingsStore.getState().themeTonePreset).toBe(originalTone)
  })

  it('对象克隆和已撤销的授权均不可执行', async () => {
    const authorized = grant()
    expect(() => createApplicationCapabilitySession({ ...authorized })).toThrow(/重新授权/)
    const session = createApplicationCapabilitySession(authorized)
    revokeApplicationCallerGrant(authorized)
    await expect(session.execute(read, request('revoked'))).rejects.toThrow(/重新授权/)
  })

  it('语义处理器共享执行端也拒绝无权限调用', async () => {
    const definition = listApplicationCapabilities().find((value) => value.id === 'open_application_surface')!
    const result = await executeApplicationCapabilityResult({ id: definition.id, version: definition.version,
      input: { surfaceId: 'workspace.canvas' },
    }, { ...request('deny-navigation'), callerGrant: grant() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain(definition.permission)
  })

  it('描述不开放助手运行、敏感属性及密钥', async () => {
    const session = createApplicationCapabilitySession(grant())
    const result = await session.execute({ id: 'describe_application_entities', version: 1, input: {} }, request('describe'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const entities = result.data.entities as Array<{ id: string }>
      expect(entities.some((value) => value.id.startsWith('assistant.'))).toBe(false)
      const properties = result.data.properties as Array<{ id: string; entityType: string }>
      const registry = getApplicationReflectionRegistry()
      expect(properties.every((value) => registry.listProperties(value.entityType)
        .some((entry) => entry.id === value.id && ['C0', 'C1'].includes(entry.dataClass)))).toBe(true)
    }
    const internal = getApplicationReflectionRegistry().describe({ domains: ['assistant_runtime'] }, {
      exposure: 'local_adapter', permissions: new Set(['application:read']), acceptedDataClasses: new Set(['C0', 'C1']),
    })
    expect(internal.entities).toEqual([])
    for (const entityType of ['assistant.run', 'assistant.artifact']) {
      const denied = await session.execute({ id: 'list_application_entities', version: 1, input: { entityType } }, request(`deny-${entityType}`))
      expect(denied.ok).toBe(false)
      if (!denied.ok) expect(denied.error.message).toContain('权限')
    }
  })

  it('截断引用和过期并发基线不会被外部适配器自动修复', async () => {
    const session = createApplicationCapabilitySession(grant(['application:read', 'application:write', 'settings:read', 'settings:write'], true))
    const truncated = await session.execute({ ...read, input: { ...read.input, ref: { kind: 'settings.registry', id: 'single...' } } }, request('truncated'))
    expect(truncated.ok).toBe(false)
    if (!truncated.ok) expect(truncated.error.message).toContain('完整稳定引用')
    const stale = await session.execute({ ...write('warm'), expectedRevisions: { settings: 999999 } }, request('stale'))
    expect(stale.ok).toBe(false)
    expect(useSettingsStore.getState().themeTonePreset).toBe(originalTone)
  })
})
