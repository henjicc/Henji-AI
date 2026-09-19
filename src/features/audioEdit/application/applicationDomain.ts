import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { AudioEditMutationExecutor } from './audioEditMutationExecutor'
import { AUDIO_EDIT_ENTITY_TYPES, createAudioEditReflectionRegistrations } from './audioEditReflection'

export const audioEditApplicationDomain: ApplicationDomainModule = {
  id: 'audioEdit',
  entities: createAudioEditReflectionRegistrations,
  registerExecutors(engine) {
    engine.registerMutationExecutor(new AudioEditMutationExecutor(AUDIO_EDIT_ENTITY_TYPES.project, [
      'audio_edit.project.name', 'audio_edit.project.reference_script',
    ]))
    engine.registerMutationExecutor(new AudioEditMutationExecutor(AUDIO_EDIT_ENTITY_TYPES.transcriptBlock, [
      'audio_edit.transcript_block.included', 'audio_edit.transcript_block.locked',
    ]))
    engine.registerMutationExecutor(new AudioEditMutationExecutor(AUDIO_EDIT_ENTITY_TYPES.suggestion, [
      'audio_edit.suggestion.status',
    ]))
    engine.registerMutationExecutor(new AudioEditMutationExecutor(AUDIO_EDIT_ENTITY_TYPES.processorChain, [
      'audio_edit.processor_chain.vst_enabled',
    ]))
  },
  registerCapabilities() {},
}
