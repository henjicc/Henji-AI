import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createSharedMemoryRegistration, SharedMemoryExecutor } from './sharedMemoryReflection'

export const memoryApplicationDomain: ApplicationDomainModule = {
  id: 'memory',
  entities: () => [createSharedMemoryRegistration()],
  registerExecutors(engine) {
    engine.registerMutationExecutor(new SharedMemoryExecutor())
  },
  registerCapabilities() {},
}
