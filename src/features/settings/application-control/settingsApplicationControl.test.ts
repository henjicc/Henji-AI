// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import type { ApplicationExecutionContext } from '@/core/application-control/index'
import { PROTECTED_APPLICATION_SETTING_DEFINITIONS } from '@/features/settings/application-control/protectedSettingDefinitions'
import { useSettingsStore } from '@/stores/settingsStore'
import { getUpdateConfig } from '@/utils/updateConfig'

import { getApplicationControlExecutionEngine, getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry'
import { getSettingsRegistryRevision } from '@/features/settings/application-control/index'

const context: ApplicationExecutionContext = {
  requestId: 'settings-control-test',
  exposure: 'assistant',
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

  it('4.4：updates.enabled 已松绑为正规可写设置，值真的落到 localStorage', async () => {
    localStorage.removeItem('update_config')
    expect(getUpdateConfig().enabled).toBe(true)

    const revision = getSettingsRegistryRevision()
    const engine = getApplicationControlExecutionEngine()
    const plan = await engine.plan({
      summary: '关闭自动更新检测',
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation',
        target: { kind: 'settings.registry', id: 'singleton' },
        entityType: 'settings.registry',
        expectedRevisions: { settings: revision },
        mutations: [{ propertyId: 'updates.enabled', operation: 'set', value: false }],
      }],
    }, context)
    const committed = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { settings: revision },
      idempotencyKey: `settings-commit-updates-${String(revision).padStart(16, '0')}`,
    }, context)
    expect(committed.status, JSON.stringify(committed)).toBe('completed')
    expect(getUpdateConfig().enabled).toBe(false)
  })

  it('受保护设置不可写，付费授权不能由调用方自行提升权限', () => {
    const ids = Object.keys(PROTECTED_APPLICATION_SETTING_DEFINITIONS)
    expect(ids).toEqual([
      'security.paid_approval',
      'security.provider_keys', 'storage.data_path', 'llm.configuration',
    ])
    for (const id of ids) {
      const definition = PROTECTED_APPLICATION_SETTING_DEFINITIONS[id]
      expect(definition.writable).toBe(false)
      const description = String(definition.description)
      expect(description).toContain('open_application_surface')
      // 理由要落到技术事实（密钥隔离、整体搬迁与用户付费策略），不是含糊的"安全"表态。
      expect(/明文|密钥|整体移动|只能由用户/.test(description)).toBe(true)
    }
  })
})
