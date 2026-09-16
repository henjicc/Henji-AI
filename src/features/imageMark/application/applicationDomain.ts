import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createImageMarkReflectionRegistrations } from './imageMarkReflection'
import { ImageMarkDocumentMutationExecutor } from './imageMarkDocumentMutationExecutor'
import { ImageMarkAnnotationMutationExecutor } from './imageMarkAnnotationMutationExecutor'
import { ImageMarkAnnotationCollectionExecutor } from './imageMarkAnnotationCollectionExecutor'
import { registerImageMarkCapabilityHandlers } from './registerImageMarkCapabilityHandlers'

export const imageMarkApplicationDomain: ApplicationDomainModule = {
  id: 'imageMark',
  entities: () => createImageMarkReflectionRegistrations(),
  registerExecutors(engine) {
    engine.registerMutationExecutor(new ImageMarkDocumentMutationExecutor())
    engine.registerMutationExecutor(new ImageMarkAnnotationMutationExecutor())
    engine.registerCollectionExecutor(new ImageMarkAnnotationCollectionExecutor())
  },
  registerCapabilities(registrar) {
    registerImageMarkCapabilityHandlers(registrar)
  },
}
