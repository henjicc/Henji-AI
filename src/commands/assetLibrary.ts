import type { ApplicationPersistenceCorrelation } from '@/core/application-control/persistenceCorrelation'
import { getPlatform } from '@/platform'
import { notifyApplicationDomainChanged } from '@/core/application-control/domainChangeSignal'
import type { AssetLibraryRecord, AssetLibrarySnapshot, AssetPage, AssetQueryInput, AssetRecord, CreateAssetInput } from '@/platform/contracts/assetLibrary'

async function assetWrite<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  const result = await operation()
  notifyApplicationDomainChanged('assets')
  return result
}

export function createAsset(input: CreateAssetInput, operationCorrelation?: ApplicationPersistenceCorrelation): Promise<AssetRecord> { return assetWrite(() => getPlatform().assetLibrary.createAsset(input, operationCorrelation)) }
export function updateAsset(id: string, name: string, operationCorrelation?: ApplicationPersistenceCorrelation): Promise<AssetRecord> { return assetWrite(() => getPlatform().assetLibrary.updateAsset(id, name, operationCorrelation)) }
export function deleteAsset(id: string, operationCorrelation?: ApplicationPersistenceCorrelation): Promise<void> { return assetWrite(() => getPlatform().assetLibrary.deleteAsset(id, operationCorrelation)) }
export function queryAssets(input: AssetQueryInput = {}): Promise<AssetPage> { return getPlatform().assetLibrary.queryAssets(input) }
export function touchAsset(id: string): Promise<void> { return assetWrite(() => getPlatform().assetLibrary.touchAsset(id)) }
export function checkAssetPaths(filePaths: string[]): Promise<boolean[]> { return getPlatform().assetLibrary.checkPaths(filePaths) }
export function inspectAsset(id: string): Promise<AssetRecord> { return getPlatform().assetLibrary.inspectAsset(id) }
export function inspectAssets(ids: string[]): Promise<AssetRecord[]> { return getPlatform().assetLibrary.inspectAssets(ids) }
export function relocateAsset(id: string, filePath: string): Promise<AssetRecord> { return assetWrite(() => getPlatform().assetLibrary.relocateAsset(id, filePath)) }
export function listAssetLibraries(): Promise<AssetLibraryRecord[]> { return getPlatform().assetLibrary.listLibraries() }
export function inspectAssetLibrary(id: string): Promise<AssetLibrarySnapshot> { return getPlatform().assetLibrary.inspectLibrary(id) }
export function createAssetLibrary(name: string, operationCorrelation?: ApplicationPersistenceCorrelation): Promise<AssetLibraryRecord> { return assetWrite(() => getPlatform().assetLibrary.createLibrary(name, operationCorrelation)) }
export function renameAssetLibrary(id: string, name: string, operationCorrelation?: ApplicationPersistenceCorrelation): Promise<AssetLibraryRecord> { return assetWrite(() => getPlatform().assetLibrary.renameLibrary(id, name, operationCorrelation)) }
export function deleteAssetLibrary(id: string, operationCorrelation?: ApplicationPersistenceCorrelation): Promise<void> { return assetWrite(() => getPlatform().assetLibrary.deleteLibrary(id, operationCorrelation)) }
export function restoreAssetLibrary(snapshot: AssetLibrarySnapshot, operationCorrelation?: ApplicationPersistenceCorrelation): Promise<AssetLibraryRecord> { return assetWrite(() => getPlatform().assetLibrary.restoreLibrary(snapshot, operationCorrelation)) }
export function addAssetToLibrary(libraryId: string, assetId: string, operationCorrelation?: ApplicationPersistenceCorrelation): Promise<void> { return assetWrite(() => getPlatform().assetLibrary.addToLibrary(libraryId, assetId, operationCorrelation)) }
export function removeAssetFromLibrary(libraryId: string, assetId: string, operationCorrelation?: ApplicationPersistenceCorrelation): Promise<void> { return assetWrite(() => getPlatform().assetLibrary.removeFromLibrary(libraryId, assetId, operationCorrelation)) }
export function listAssetTags(): Promise<string[]> { return getPlatform().assetLibrary.listTags() }
export function setAssetTags(assetId: string, tags: string[], operationCorrelation?: ApplicationPersistenceCorrelation): Promise<AssetRecord> { return assetWrite(() => getPlatform().assetLibrary.setAssetTags(assetId, tags, operationCorrelation)) }
export function rebaseAssetDataRoot(oldRoot: string, newRoot: string): Promise<number> { return assetWrite(() => getPlatform().assetLibrary.rebaseDataRoot(oldRoot, newRoot)) }
