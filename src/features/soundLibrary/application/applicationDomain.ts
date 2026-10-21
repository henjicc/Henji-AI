import type { ApplicationDomainModule } from '@/features/application-control'
import { addSoundLibraryFolderCapability, searchSoundEffectsCapability } from '@/core/application-control/domains/soundLibrary/soundLibraryCapabilities'
import { addSoundLibraryFolderFromCapability, searchSoundEffectsFromCapability } from './soundLibraryCapabilities'
import { createSoundLibraryRegistrations, SoundLibraryFolderCollectionExecutor } from './soundLibraryReflection'

export const soundLibraryApplicationDomain: ApplicationDomainModule = {
  id: 'sound_library',
  entities: () => createSoundLibraryRegistrations(),
  registerExecutors(engine) {
    engine.registerCollectionExecutor(new SoundLibraryFolderCollectionExecutor())
  },
  registerCapabilities(registrar) {
    registrar.registerHandler(addSoundLibraryFolderCapability.id, addSoundLibraryFolderFromCapability)
    registrar.registerHandler(searchSoundEffectsCapability.id, searchSoundEffectsFromCapability)
  },
}
