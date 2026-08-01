import {
  ApplicationControlExecutionEngine,
  ApplicationReflectionRegistry,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import { createSettingsReflectionRegistration } from './settingsReflection'
import { SettingsMutationExecutor } from './settingsMutationExecutor'

let registry: ApplicationReflectionRegistry | undefined
let executionEngine: ApplicationControlExecutionEngine | undefined

export function getApplicationReflectionRegistry(): ApplicationReflectionRegistry {
  if (!registry) {
    registry = new ApplicationReflectionRegistry(APPLICATION_CAPABILITY_CATALOG_VERSION)
    registry.register(createSettingsReflectionRegistration())
  }
  return registry
}

export function getApplicationControlExecutionEngine(): ApplicationControlExecutionEngine {
  if (!executionEngine) {
    executionEngine = new ApplicationControlExecutionEngine(getApplicationReflectionRegistry())
    executionEngine.registerMutationExecutor(new SettingsMutationExecutor())
  }
  return executionEngine
}
