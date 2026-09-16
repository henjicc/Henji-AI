import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createAssetReflectionRegistrations } from './assetReflection'
import { AssetMutationExecutor, type AssetMutationDependencies } from './assetMutationExecutor'
import { AssetLibraryMutationExecutor } from './assetLibraryMutationExecutor'
import { AssetLibraryCollectionExecutor } from './assetLibraryCollectionExecutor'
import { registerAssetCapabilityHandlers } from './registerAssetCapabilityHandlers'

let dependencies: AssetMutationDependencies = { readRevision: () => 0, bumpRevision: () => undefined }
export function configureAssetMutationDependencies(value: AssetMutationDependencies): void { dependencies = value }

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
