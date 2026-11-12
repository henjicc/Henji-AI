import { registerCurrentDocumentProvider } from '@/features/documents'
import { useAudioEditStore } from '../store/audioEditStore'
import { registerAudioEditCapabilityHandlers } from './registerAudioEditCapabilityHandlers'
import { resolveAudioEditPersistenceParticipants } from './audioEditProjectInstances'
import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { AudioEditMutationExecutor } from './audioEditMutationExecutor'
import { AUDIO_EDIT_ENTITY_TYPES, createAudioEditReflectionRegistrations } from './audioEditReflection'

/** 只有口播页真的显示着才算当前文档；页面切走后 store 仍记着它，那时它只是后台持有，可以被释放。 */
export function audioEditCurrentDocument(host: { activeWorkspace: string; activeToolId: string | null }): string | undefined {
  return host.activeWorkspace === 'tools' && host.activeToolId === 'audioEdit' ? useAudioEditStore.getState().project?.id : undefined
}

export const audioEditApplicationDomain: ApplicationDomainModule = {
  id: 'audioEdit',
  entities: createAudioEditReflectionRegistrations,
  registerExecutors(engine) {
    for (const type of [AUDIO_EDIT_ENTITY_TYPES.project, AUDIO_EDIT_ENTITY_TYPES.transcriptBlock, AUDIO_EDIT_ENTITY_TYPES.caption, AUDIO_EDIT_ENTITY_TYPES.suggestion, AUDIO_EDIT_ENTITY_TYPES.breath]) engine.registerMutationExecutor(new AudioEditMutationExecutor(type))
  },
  registerCapabilities(registrar) {
    registerCurrentDocumentProvider('audioEdit', audioEditCurrentDocument)
    registerAudioEditCapabilityHandlers(registrar)
  },
  resolvePersistenceParticipants: resolveAudioEditPersistenceParticipants,
}
