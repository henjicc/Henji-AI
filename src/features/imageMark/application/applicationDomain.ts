import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createImageMarkReflectionRegistrations } from './imageMarkReflection'
import { ImageMarkAnnotationMutationExecutor } from './imageMarkAnnotationMutationExecutor'
import { ImageMarkAnnotationCollectionExecutor } from './imageMarkAnnotationCollectionExecutor'

export const imageMarkApplicationDomain: ApplicationDomainModule = {
  id: 'imageMark',
  registerCapabilities() {},
  entities: () => createImageMarkReflectionRegistrations(),
  registerExecutors(engine) {
    engine.registerMutationExecutor(new ImageMarkAnnotationMutationExecutor())
    engine.registerCollectionExecutor(new ImageMarkAnnotationCollectionExecutor())
  },
}
