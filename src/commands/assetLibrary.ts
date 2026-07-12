import { getPlatform } from '@/platform'
import type { AssetLibraryRecord, AssetPage, AssetQueryInput, AssetRecord, CreateAssetInput } from '@/platform/contracts/assetLibrary'
export function createAsset(input: CreateAssetInput): Promise<AssetRecord> { return getPlatform().assetLibrary.createAsset(input) }
export function updateAsset(id: string, name: string): Promise<AssetRecord> { return getPlatform().assetLibrary.updateAsset(id, name) }
export function deleteAsset(id: string): Promise<void> { return getPlatform().assetLibrary.deleteAsset(id) }
export function queryAssets(input: AssetQueryInput = {}): Promise<AssetPage> { return getPlatform().assetLibrary.queryAssets(input) }
export function touchAsset(id: string): Promise<void> { return getPlatform().assetLibrary.touchAsset(id) }
export function inspectAsset(id: string): Promise<AssetRecord> { return getPlatform().assetLibrary.inspectAsset(id) }
export function inspectAssets(ids: string[]): Promise<AssetRecord[]> { return getPlatform().assetLibrary.inspectAssets(ids) }
export function relocateAsset(id: string, filePath: string): Promise<AssetRecord> { return getPlatform().assetLibrary.relocateAsset(id, filePath) }
export function listAssetLibraries(): Promise<AssetLibraryRecord[]> { return getPlatform().assetLibrary.listLibraries() }
export function createAssetLibrary(name: string): Promise<AssetLibraryRecord> { return getPlatform().assetLibrary.createLibrary(name) }
export function renameAssetLibrary(id: string, name: string): Promise<AssetLibraryRecord> { return getPlatform().assetLibrary.renameLibrary(id, name) }
export function deleteAssetLibrary(id: string): Promise<void> { return getPlatform().assetLibrary.deleteLibrary(id) }
export function addAssetToLibrary(libraryId: string, assetId: string): Promise<void> { return getPlatform().assetLibrary.addToLibrary(libraryId, assetId) }
export function removeAssetFromLibrary(libraryId: string, assetId: string): Promise<void> { return getPlatform().assetLibrary.removeFromLibrary(libraryId, assetId) }

