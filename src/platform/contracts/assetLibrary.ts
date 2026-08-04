export type AssetMediaType = 'image' | 'video' | 'audio'
export type AssetSource = 'generated' | 'canvas' | 'camera-stage' | 'imported' | 'external'
export type AssetInspectionStatus = 'pending' | 'ready' | 'missing' | 'failed'
export interface AssetRecord { id: string; wasExisting?: boolean; mediaType: AssetMediaType; displayName: string; filePath: string; displayUrl: string; source: AssetSource; mimeType: string | null; sizeBytes: number | null; width: number | null; height: number | null; durationSeconds: number | null; thumbnailPath: string | null; thumbnailUrl: string | null; inspectionStatus: AssetInspectionStatus; inspectionError: string | null; fileModifiedAt: number | null; lastUsedAt: number | null; createdAt: number; updatedAt: number; tags: string[]; libraryIds: string[] }
export interface AssetLibraryRecord { id: string; name: string; createdAt: number; updatedAt: number }
export interface AssetLibrarySnapshot extends AssetLibraryRecord { assetIds: string[] }
export interface CreateAssetInput { filePath: string; mediaType: AssetMediaType; displayName?: string; source: AssetSource; libraryIds?: string[] }
export interface AssetQueryInput { mediaType?: AssetMediaType; libraryId?: string; tag?: string; keyword?: string; page?: number; pageSize?: number; sort?: 'created' | 'recent' }
export interface AssetPage { items: AssetRecord[]; total: number; page: number; pageSize: number }
export interface AssetLibraryPlatform {
  createAsset(input: CreateAssetInput): Promise<AssetRecord>
  updateAsset(id: string, name: string): Promise<AssetRecord>
  deleteAsset(id: string): Promise<void>
  queryAssets(input: AssetQueryInput): Promise<AssetPage>
  touchAsset(id: string): Promise<void>
  checkPaths(filePaths: string[]): Promise<boolean[]>
  inspectAsset(id: string): Promise<AssetRecord>
  inspectAssets(ids: string[]): Promise<AssetRecord[]>
  relocateAsset(id: string, filePath: string): Promise<AssetRecord>
  listLibraries(): Promise<AssetLibraryRecord[]>
  inspectLibrary(id: string): Promise<AssetLibrarySnapshot>
  createLibrary(name: string): Promise<AssetLibraryRecord>
  renameLibrary(id: string, name: string): Promise<AssetLibraryRecord>
  deleteLibrary(id: string): Promise<void>
  restoreLibrary(snapshot: AssetLibrarySnapshot): Promise<AssetLibraryRecord>
  addToLibrary(libraryId: string, assetId: string): Promise<void>
  removeFromLibrary(libraryId: string, assetId: string): Promise<void>
  listTags(): Promise<string[]>
  setAssetTags(assetId: string, tags: string[]): Promise<AssetRecord>
  rebaseDataRoot(oldRoot: string, newRoot: string): Promise<number>
}
