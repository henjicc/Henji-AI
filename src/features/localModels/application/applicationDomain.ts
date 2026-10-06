import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import {
  createLocalModelRegistrations,
  LocalModelMutationExecutor,
  LocalModelSettingsMutationExecutor,
} from './localModelsReflection'

export const localModelsApplicationDomain: ApplicationDomainModule = {
  id: 'local_models',
  entities: () => createLocalModelRegistrations(),
  registerExecutors(engine) {
    engine.registerMutationExecutor(new LocalModelMutationExecutor())
    engine.registerMutationExecutor(new LocalModelSettingsMutationExecutor())
  },
  registerCapabilities() {},
}
