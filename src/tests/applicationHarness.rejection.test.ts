// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createApplicationHarness } from './applicationHarness'
import { loadRealModelsIntoRegistry } from './loadRealModels'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry'

beforeAll(async () => { installHarnessNativeStorage(); await loadRealModelsIntoRegistry() })
afterAll(() => uninstallHarnessNativeStorage())

it('真实目录覆盖全部领域，各域拒绝未知实体及属性，错误不污染下一次调用', async () => {
  const app = createApplicationHarness()
  try {
    const registry = getApplicationReflectionRegistry()
    const description = registry.describe({}, { exposure: 'local_adapter',
      permissions: new Set(registry.listDeclaredPropertyPermissions()), acceptedDataClasses: new Set(['C0', 'C1']) })
    const entities = [...new Map(description.entities.map(entity => [entity.domain, entity])).values()]
    expect(entities.length).toBeGreaterThanOrEqual(8)
    expect(app.session.list().length).toBeGreaterThan(30)
    for (const entity of entities) {
      const unknown = await app.call('list_application_entities', { entityType: `${entity.id}__unknown` })
      expect(unknown.ok, entity.id).toBe(false)
      const property = `${entity.id}.__unknown`
      const result = await app.call('change_application_entities', { summary: '拒绝未知属性', changes: [{
        kind: 'set_properties', entityType: entity.id, target: { kind: entity.refKind, id: 'missing-test-ref' },
        properties: { [property]: 1 },
      }] })
      expect(result.ok, `${entity.id}: ${JSON.stringify(result)}`).toBe(false)
      if (!result.ok) expect(result.error.message.length).toBeGreaterThan(0)
      const valid = await app.call('describe_application_entities', { entityTypes: [entity.id] })
      expect(valid.ok, JSON.stringify(valid)).toBe(true)
    }
  } finally { app.dispose() }
})

it('严格拒绝工具输入中的授权字段和超限数组', async () => {
  const app = createApplicationHarness()
  try {
    for (const input of [{ allowWrites: true }, { callerGrant: {} }, { entityTypes: Array(33).fill('canvas.node') }]) {
      const result = await app.call('describe_application_entities', input)
      expect(result.ok, JSON.stringify(result)).toBe(false)
    }
  } finally { app.dispose() }
})
