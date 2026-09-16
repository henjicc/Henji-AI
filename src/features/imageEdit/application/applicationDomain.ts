import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createImageEditReflectionRegistrations } from './imageEditReflection'
import { ImageEditV3LayerMutationExecutor, ImageEditV3GroupMutationExecutor, ImageEditV3MaskMutationExecutor } from '../v3/application/imageEditV3MutationExecutors'
import { ImageEditV3CollectionExecutor } from '../v3/application/imageEditV3CollectionExecutor'
import { resolveImageEditPersistenceParticipantsV3 } from '../v3/application/imageEditPersistenceOperations'
import { registerImageEditCapabilityHandlers } from './registerImageEditCapabilityHandlers'
import { openImageEditorWithSourceCapability } from '@/core/application-control/builtinApplicationCapabilities'
import { openImageEditorWithSource } from './imageSourceCapabilityService'

export const imageEditApplicationDomain: ApplicationDomainModule = {
  id: 'imageEdit',
  entities: () => createImageEditReflectionRegistrations(),
  registerExecutors(engine) {
    engine.registerMutationExecutor(new ImageEditV3LayerMutationExecutor())
    engine.registerMutationExecutor(new ImageEditV3GroupMutationExecutor())
    engine.registerMutationExecutor(new ImageEditV3MaskMutationExecutor())
    for (const entityType of ['image_edit.layer', 'image_edit.group'] as const) engine.registerCollectionExecutor(new ImageEditV3CollectionExecutor(entityType))
  },
  registerCapabilities(registrar) {
    registerImageEditCapabilityHandlers(registrar)
    registrar.registerHandler(openImageEditorWithSourceCapability.id, async (input, context) => {
      const parsed = openImageEditorWithSourceCapability.inputSchema.parse(input)
      return openImageEditorWithSource(parsed.sourceRef, context)
    })
  },
  resolvePersistenceParticipants: resolveImageEditPersistenceParticipantsV3,
}
