import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createAssetReflectionRegistrations } from './assetReflection'
import { AssetMutationExecutor } from './assetMutationExecutor'
import { AssetLibraryMutationExecutor } from './assetLibraryMutationExecutor'
import { AssetLibraryCollectionExecutor } from './assetLibraryCollectionExecutor'
import { registerAssetCapabilityHandlers } from './registerAssetCapabilityHandlers'

import { dependencies } from './assetControlDependencies'
import { RecyclableCollectionExecutor } from '@/features/application-control'
import { assetApplicationService } from './assetApplicationService'
export { configureAssetMutationDependencies } from './assetControlDependencies'

export const assetsApplicationDomain: ApplicationDomainModule = {
  id: 'assets',
  entities: () => createAssetReflectionRegistrations(() => dependencies.readRevision()),
  registerExecutors(engine) {
    const current = { readRevision: () => dependencies.readRevision(), bumpRevision: () => dependencies.bumpRevision() }
    engine.registerMutationExecutor(new AssetMutationExecutor(current))
    engine.registerMutationExecutor(new AssetLibraryMutationExecutor(current))
    engine.registerCollectionExecutor(new AssetLibraryCollectionExecutor(current))
    engine.registerCollectionExecutor(new RecyclableCollectionExecutor('asset', {
      read: ref => assetApplicationService.read(ref.id),
      remove: async ref => { await assetApplicationService.delete(ref.id); return `assets:${ref.id}` },
      revisions: () => ({ assets: dependencies.readRevision() }), changed: () => { dependencies.bumpRevision() },
    }))
  },
  registerCapabilities(registrar) {
    registerAssetCapabilityHandlers(registrar)
  },
}
