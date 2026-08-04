import {
  addAssetToLibrary,
  createAssetLibrary,
  deleteAsset,
  deleteAssetLibrary,
  inspectAssetLibrary,
  inspectAsset,
  listAssetLibraries,
  listAssetTags,
  queryAssets,
  removeAssetFromLibrary,
  setAssetTags,
  updateAsset,
  renameAssetLibrary,
  restoreAssetLibrary,
} from '@/commands/assetLibrary'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import type { AssetQueryInput, AssetRecord } from '@/platform/contracts/assetLibrary'
import type { AssetLibrarySnapshot } from '@/platform/contracts/assetLibrary'

function publicAsset(asset: AssetRecord): Record<string, unknown> {
  const { filePath: _filePath, thumbnailPath: _thumbnailPath, ...safe } = asset
  return safe
}

export interface AssetMutationSnapshot {
  displayName: string
  tags: string[]
  libraryIds: string[]
}

export const assetApplicationService = {
  async query(input: AssetQueryInput): Promise<Record<string, unknown>> {
    const page = await queryAssets(input)
    return { ...page, items: page.items.map(publicAsset) }
  },

  async read(assetId: string): Promise<Record<string, unknown>> {
    return publicAsset(await inspectAsset(assetId))
  },

  async readMutationSnapshot(assetId: string): Promise<AssetMutationSnapshot> {
    const asset = await inspectAsset(assetId)
    return {
      displayName: asset.displayName,
      tags: [...asset.tags],
      libraryIds: [...asset.libraryIds],
    }
  },

  inspect: inspectAsset,

  async listLibraries(): Promise<Record<string, unknown>[]> {
    return (await listAssetLibraries()).map((library) => ({ ...library }))
  },

  async renameLibrary(libraryId: string, name: string): Promise<Record<string, unknown>> {
    const library = await renameAssetLibrary(libraryId, name)
    return { ...library }
  },

  async inspectLibrary(libraryId: string): Promise<AssetLibrarySnapshot> {
    return await inspectAssetLibrary(libraryId)
  },

  async createLibrary(name: string): Promise<Record<string, unknown>> {
    return { ...await createAssetLibrary(name) }
  },

  async deleteLibrary(libraryId: string): Promise<Record<string, unknown>> {
    await deleteAssetLibrary(libraryId)
    return { libraryId, status: 'deleted' }
  },

  async restoreLibrary(snapshot: AssetLibrarySnapshot): Promise<Record<string, unknown>> {
    return { ...await restoreAssetLibrary(snapshot) }
  },

  async listTags(): Promise<string[]> {
    return await listAssetTags()
  },

  async select(assetId: string | null): Promise<Record<string, unknown>> {
    useAssetLibraryStore.getState().setSelectedAsset(assetId ? await inspectAsset(assetId) : null)
    return { assetId }
  },

  async replaceTags(assetId: string, tags: string[]): Promise<Record<string, unknown>> {
    const asset = await setAssetTags(assetId, tags)
    return { assetId: asset.id, tags: asset.tags, revision: asset.updatedAt }
  },

  async rename(assetId: string, displayName: string): Promise<Record<string, unknown>> {
    const asset = await updateAsset(assetId, displayName)
    return { assetId: asset.id, displayName: asset.displayName, revision: asset.updatedAt }
  },

  async addToLibrary(libraryId: string, assetId: string): Promise<Record<string, unknown>> {
    await addAssetToLibrary(libraryId, assetId)
    return { libraryId, assetId, status: 'added' }
  },

  async removeFromLibrary(libraryId: string, assetId: string): Promise<Record<string, unknown>> {
    await removeAssetFromLibrary(libraryId, assetId)
    return { libraryId, assetId, status: 'removed' }
  },

  async delete(assetId: string): Promise<Record<string, unknown>> {
    await deleteAsset(assetId)
    if (useAssetLibraryStore.getState().selectedAsset?.id === assetId) {
      useAssetLibraryStore.getState().setSelectedAsset(null)
    }
    return { assetId, status: 'deleted' }
  },
}
