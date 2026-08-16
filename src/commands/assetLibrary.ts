import { getPlatform } from '@/platform'
import { notifyApplicationDomainChanged } from '@/core/application-control/domainChangeSignal'
import type { AssetLibraryRecord, AssetLibrarySnapshot, AssetPage, AssetQueryInput, AssetRecord, CreateAssetInput } from '@/platform/contracts/assetLibrary'

async function assetWrite<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  const result = await operation()
  notifyApplicationDomainChanged('assets')
  return result
}

export function createAsset(input: CreateAssetInput): Promise<AssetRecord> { return assetWrite(() => getPlatform().assetLibrary.createAsset(input)) }
export function updateAsset(id: string, name: string): Promise<AssetRecord> { return assetWrite(() => getPlatform().assetLibrary.updateAsset(id, name)) }
export function deleteAsset(id: string): Promise<void> { return assetWrite(() => getPlatform().assetLibrary.deleteAsset(id)) }
export function queryAssets(input: AssetQueryInput = {}): Promise<AssetPage> { return getPlatform().assetLibrary.queryAssets(input) }
export function touchAsset(id: string): Promise<void> { return assetWrite(() => getPlatform().assetLibrary.touchAsset(id)) }
export function checkAssetPaths(filePaths: string[]): Promise<boolean[]> { return getPlatform().assetLibrary.checkPaths(filePaths) }
export function inspectAsset(id: string): Promise<AssetRecord> { return getPlatform().assetLibrary.inspectAsset(id) }
export function inspectAssets(ids: string[]): Promise<AssetRecord[]> { return getPlatform().assetLibrary.inspectAssets(ids) }
export function relocateAsset(id: string, filePath: string): Promise<AssetRecord> { return assetWrite(() => getPlatform().assetLibrary.relocateAsset(id, filePath)) }
export function listAssetLibraries(): Promise<AssetLibraryRecord[]> { return getPlatform().assetLibrary.listLibraries() }
export function inspectAssetLibrary(id: string): Promise<AssetLibrarySnapshot> { return getPlatform().assetLibrary.inspectLibrary(id) }
export function createAssetLibrary(name: string): Promise<AssetLibraryRecord> { return assetWrite(() => getPlatform().assetLibrary.createLibrary(name)) }
export function renameAssetLibrary(id: string, name: string): Promise<AssetLibraryRecord> { return assetWrite(() => getPlatform().assetLibrary.renameLibrary(id, name)) }
export function deleteAssetLibrary(id: string): Promise<void> { return assetWrite(() => getPlatform().assetLibrary.deleteLibrary(id)) }
export function restoreAssetLibrary(snapshot: AssetLibrarySnapshot): Promise<AssetLibraryRecord> { return assetWrite(() => getPlatform().assetLibrary.restoreLibrary(snapshot)) }
export function addAssetToLibrary(libraryId: string, assetId: string): Promise<void> { return assetWrite(() => getPlatform().assetLibrary.addToLibrary(libraryId, assetId)) }
export function removeAssetFromLibrary(libraryId: string, assetId: string): Promise<void> { return assetWrite(() => getPlatform().assetLibrary.removeFromLibrary(libraryId, assetId)) }
export function listAssetTags(): Promise<string[]> { return getPlatform().assetLibrary.listTags() }
export function setAssetTags(assetId: string, tags: string[]): Promise<AssetRecord> { return assetWrite(() => getPlatform().assetLibrary.setAssetTags(assetId, tags)) }
export function rebaseAssetDataRoot(oldRoot: string, newRoot: string): Promise<number> { return assetWrite(() => getPlatform().assetLibrary.rebaseDataRoot(oldRoot, newRoot)) }
