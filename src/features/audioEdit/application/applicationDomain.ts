import { registerCurrentDocumentProvider } from '@/features/documents'
import { useAudioEditStore } from '../store/audioEditStore'
import { registerAudioEditCapabilityHandlers } from './registerAudioEditCapabilityHandlers'
import { resolveAudioEditPersistenceParticipants } from './audioEditProjectInstances'
import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { AudioEditMutationExecutor } from './audioEditMutationExecutor'
import { AUDIO_EDIT_ENTITY_TYPES, createAudioEditReflectionRegistrations } from './audioEditReflection'

export const audioEditApplicationDomain: ApplicationDomainModule = {
  id: 'audioEdit',
  entities: createAudioEditReflectionRegistrations,
  registerExecutors(engine) {
    for (const type of [AUDIO_EDIT_ENTITY_TYPES.project, AUDIO_EDIT_ENTITY_TYPES.transcriptBlock, AUDIO_EDIT_ENTITY_TYPES.suggestion, AUDIO_EDIT_ENTITY_TYPES.breath]) engine.registerMutationExecutor(new AudioEditMutationExecutor(type))
  },
  registerCapabilities(registrar) {
    registerCurrentDocumentProvider('audioEdit', host => host.activeWorkspace === 'tools' && host.activeToolId === 'audioEdit' ? useAudioEditStore.getState().project?.id : undefined)
    registerAudioEditCapabilityHandlers(registrar)
  },
  resolvePersistenceParticipants: resolveAudioEditPersistenceParticipants,
}
