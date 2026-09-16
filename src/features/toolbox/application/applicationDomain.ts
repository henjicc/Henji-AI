import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createToolboxReflectionRegistration } from './toolboxReflection'
import { registerToolboxCapabilityHandlers } from './registerToolboxCapabilityHandlers'

export const toolboxApplicationDomain: ApplicationDomainModule = {
  id: 'toolbox',
  entities: () => [createToolboxReflectionRegistration()],
  registerExecutors() {},
  registerCapabilities(registrar) {
    registerToolboxCapabilityHandlers(registrar)
  },
}
