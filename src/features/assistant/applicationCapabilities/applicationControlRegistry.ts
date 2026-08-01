import { ApplicationReflectionRegistry } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import { createSettingsReflectionRegistration } from './settingsReflection'

let registry: ApplicationReflectionRegistry | undefined

export function getApplicationReflectionRegistry(): ApplicationReflectionRegistry {
  if (!registry) {
    registry = new ApplicationReflectionRegistry(APPLICATION_CAPABILITY_CATALOG_VERSION)
    registry.register(createSettingsReflectionRegistration())
  }
  return registry
}
