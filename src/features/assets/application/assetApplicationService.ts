import {
  addAssetToLibrary,
  deleteAsset,
  inspectAsset,
  listAssetLibraries,
  listAssetTags,
  queryAssets,
  removeAssetFromLibrary,
  setAssetTags,
} from '@/commands/assetLibrary'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import type { AssetQueryInput, AssetRecord } from '@/platform/contracts/assetLibrary'

function publicAsset(asset: AssetRecord): Record<string, unknown> {
  const { filePath: _filePath, thumbnailPath: _thumbnailPath, ...safe } = asset
  return safe
}

export const assetApplicationService = {
  async query(input: AssetQueryInput): Promise<Record<string, unknown>> {
    const page = await queryAssets(input)
    return { ...page, items: page.items.map(publicAsset) }
  },

  async read(assetId: string): Promise<Record<string, unknown>> {
    return publicAsset(await inspectAsset(assetId))
  },

  inspect: inspectAsset,

  async listLibraries(): Promise<Record<string, unknown>[]> {
    return (await listAssetLibraries()).map((library) => ({ ...library }))
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
