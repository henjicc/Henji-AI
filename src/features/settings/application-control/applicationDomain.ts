import { listApplicationSettingIds } from './settingsApplicationService'
import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createSettingsReflectionRegistration } from './settingsReflection'
import { SettingsMutationExecutor } from './settingsMutationExecutor'
import { getApplicationSettingsCapability, searchApplicationSettingsCapability } from '@/core/application-control/domains/settings/settingsApplicationCapabilities'
import { getApplicationSettings, searchApplicationSettings } from './settingsApplicationService'
import { createRecycleReflectionRegistration, RecycleCollectionExecutor } from './recycleReflection'
import { skillCollection, providerCollection } from './settingsRecordCollections'

export const settingsApplicationDomain: ApplicationDomainModule = {
  id: 'settings',
  entities: () => [createSettingsReflectionRegistration(), createRecycleReflectionRegistration(), skillCollection.registration, providerCollection.registration],
  registerExecutors(engine) {
    engine.registerMutationExecutor(new SettingsMutationExecutor())
    engine.registerCollectionExecutor(new RecycleCollectionExecutor())
    engine.registerCollectionExecutor(skillCollection.executor)
    engine.registerCollectionExecutor(providerCollection.executor)
  },
  registerCapabilities(registrar) {
    registrar.registerHandler(searchApplicationSettingsCapability.id, input => {
      const parsed = searchApplicationSettingsCapability.inputSchema.parse(input)
      return { settings: searchApplicationSettings(parsed.query, parsed.limit) }
    })
    registrar.registerHandler(getApplicationSettingsCapability.id, input => getApplicationSettings(getApplicationSettingsCapability.inputSchema.parse(input).ids))
  },
  validate() { if (listApplicationSettingIds().length === 0) throw new Error('应用设置注册中心为空') },
}
