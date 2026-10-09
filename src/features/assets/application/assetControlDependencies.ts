import type { AssetMutationDependencies } from './assetMutationExecutor'

export let dependencies: AssetMutationDependencies = { readRevision: () => 0, bumpRevision: () => undefined }
export function configureAssetMutationDependencies(value: AssetMutationDependencies): void { dependencies = value }
