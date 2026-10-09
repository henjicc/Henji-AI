import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createAssetReflectionRegistrations } from './assetReflection'
import { AssetMutationExecutor } from './assetMutationExecutor'
import { AssetLibraryMutationExecutor } from './assetLibraryMutationExecutor'
import { AssetLibraryCollectionExecutor } from './assetLibraryCollectionExecutor'
import { registerAssetCapabilityHandlers } from './registerAssetCapabilityHandlers'

import { dependencies } from './assetControlDependencies'
export { configureAssetMutationDependencies } from './assetControlDependencies'

export const assetsApplicationDomain: ApplicationDomainModule = {
  id: 'assets',
  entities: () => createAssetReflectionRegistrations(() => dependencies.readRevision()),
  registerExecutors(engine) {
    const current = { readRevision: () => dependencies.readRevision(), bumpRevision: () => dependencies.bumpRevision() }
    engine.registerMutationExecutor(new AssetMutationExecutor(current))
    engine.registerMutationExecutor(new AssetLibraryMutationExecutor(current))
    engine.registerCollectionExecutor(new AssetLibraryCollectionExecutor(current))
  },
  registerCapabilities(registrar) {
    registerAssetCapabilityHandlers(registrar)
  },
}
