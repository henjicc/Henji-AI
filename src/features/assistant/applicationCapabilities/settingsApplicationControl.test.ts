import { beforeEach, describe, expect, it } from 'vitest'

import type { ApplicationExecutionContext } from '@/core/application-control'
import { useSettingsStore } from '@/stores/settingsStore'

import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from './applicationControlRegistry'
import { getSettingsRegistryRevision } from './settingsRegistry'

const context: ApplicationExecutionContext = {
  requestId: 'settings-control-test',
  exposure: 'assistant',
  permissions: new Set(['settings:read', 'settings:write']),
  acceptedDataClasses: new Set(['C0', 'C1']),
}

describe('settings application control adapter', () => {
  beforeEach(() => {
    useSettingsStore.getState().setUiBlurEnabled(true)
  })

  it('通过统一计划提交和撤销协议复用正式设置写入', async () => {
    const revision = getSettingsRegistryRevision()
    const registry = getApplicationReflectionRegistry()
    const snapshot = await registry.readEntity(
      { kind: 'settings.registry', id: 'singleton' },
      ['interface.blur_enabled'],
      context
    )
    expect(snapshot.properties['interface.blur_enabled']).toBe(true)

    const engine = getApplicationControlExecutionEngine()
    const plan = await engine.plan({
      summary: '关闭毛玻璃效果',
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation',
        target: { kind: 'settings.registry', id: 'singleton' },
        entityType: 'settings.registry',
        expectedRevisions: { settings: revision },
        mutations: [{ propertyId: 'interface.blur_enabled', operation: 'set', value: false }],
      }],
    }, context)
    const committed = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { settings: revision },
      idempotencyKey: `settings-commit-${String(revision).padStart(16, '0')}`,
    }, context)
    expect(committed.status, JSON.stringify(committed)).toBe('completed')
    expect(useSettingsStore.getState().uiBlurEnabled).toBe(false)
    if (committed.status !== 'completed' || !committed.undoRef) throw new Error('UNDO_REF_MISSING')

    const undone = await engine.undo({
      undoRef: committed.undoRef,
      expectedRevisions: committed.resultingRevisions,
      idempotencyKey: `settings-undo-${String(revision).padStart(18, '0')}`,
    }, context)
    expect(undone.status).toBe('completed')
    expect(useSettingsStore.getState().uiBlurEnabled).toBe(true)
  })
})
