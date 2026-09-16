// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import type { ApplicationExecutionContext } from '@/core/application-control'
import { PROTECTED_APPLICATION_SETTING_DEFINITIONS } from '@/features/settings/application-control/protectedSettingDefinitions'
import { useSettingsStore } from '@/stores/settingsStore'
import { getUpdateConfig } from '@/utils/updateConfig'

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

  it('4.4：其余 5 项受保护设置仍不可写，理由是技术事实且不再提"models.visibility"/"updates.configuration"占位符', () => {
    const ids = Object.keys(PROTECTED_APPLICATION_SETTING_DEFINITIONS)
    expect(ids).toEqual([
      'security.provider_keys', 'storage.download_paths', 'storage.data_path',
      'downloads.quick_path', 'llm.configuration',
    ])
    for (const id of ids) {
      const definition = PROTECTED_APPLICATION_SETTING_DEFINITIONS[id]
      expect(definition.writable).toBe(false)
      const description = String(definition.description)
      expect(description).toContain('open_application_surface')
      // 理由要落到技术事实（明文密钥 / OS 对话框不在渲染进程），不是含糊的"安全"表态。
      expect(/明文|密钥|OS 文件|系统弹出|系统确认|系统选择器/.test(description)).toBe(true)
    }
  })
})
