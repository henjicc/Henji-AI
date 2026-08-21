import { describe, expect, it } from 'vitest'

import {
  ONBOARDING_STATE_VERSION,
  ONBOARDING_STORAGE_KEY,
  OnboardingManager,
  type OnboardingStorage,
} from './onboardingManager'
import { ModelDefaultsManager } from '@/features/settings/modelDefaultsManager'

class MemoryStorage implements OnboardingStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function createManager(storage = new MemoryStorage()): OnboardingManager {
  return new OnboardingManager(storage, new ModelDefaultsManager(storage))
}

describe('OnboardingManager', () => {
  it('新安装自动打开欢迎流程并写入版本化状态', () => {
    const storage = new MemoryStorage()
    const manager = createManager(storage)

    expect(manager.getSnapshot()).toMatchObject({
      version: ONBOARDING_STATE_VERSION,
      status: 'not_started',
      entryReason: 'fresh_install',
      activeStepId: 'welcome',
      isOpen: true,
    })
    expect(JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? '{}')).toMatchObject({
      version: ONBOARDING_STATE_VERSION,
    })
  })

  it('已有安装首次升级时静默完成，避免打断用户', () => {
    const storage = new MemoryStorage()
    storage.setItem('settings-storage', '{}')

    const manager = createManager(storage)

    expect(manager.getSnapshot()).toMatchObject({
      status: 'completed',
      entryReason: 'existing_install',
      isOpen: false,
    })
  })

  it('支持继续、返回、稍后和手动重新运行', () => {
    const manager = createManager()
    manager.open()
    manager.next()
    manager.next()
    expect(manager.getSnapshot().activeStepId).toBe('provider')

    manager.back()
    expect(manager.getSnapshot().activeStepId).toBe('basics')
    manager.defer()
    expect(manager.getSnapshot().isOpen).toBe(false)

    manager.skip()
    manager.open()
    expect(manager.getSnapshot()).toMatchObject({
      status: 'in_progress',
      entryReason: 'manual',
      activeStepId: 'welcome',
      isOpen: true,
    })
  })

  it('记录主供应商、密钥验证和首次真实任务完成', () => {
    const manager = createManager()
    manager.open()
    manager.setPrimaryProvider('apimart')
    manager.markProviderConfigured('apimart')
    manager.markProviderConnection('apimart', true)
    manager.prepareFirstTask()
    manager.markGenerationCompleted()

    expect(manager.getSnapshot()).toMatchObject({
      status: 'completed',
      primaryProvider: 'apimart',
      configuredProviders: ['apimart'],
      verifiedProviders: ['apimart'],
      firstTaskPrepared: true,
      firstTaskCompleted: true,
      isOpen: false,
    })
  })

  it('损坏状态回退为可继续的新安装流程', () => {
    const storage = new MemoryStorage()
    storage.setItem(ONBOARDING_STORAGE_KEY, '{broken')

    expect(createManager(storage).getSnapshot()).toMatchObject({
      status: 'not_started',
      entryReason: 'fresh_install',
      isOpen: true,
    })
  })
})
