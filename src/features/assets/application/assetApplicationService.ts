import { v4 as uuidv4 } from 'uuid'
import type { ApplicationPersistenceCorrelation } from '@/core/application-control/persistenceCorrelation'
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

type AssetOperationContext = { operationId?: string }
function persistence(context: AssetOperationContext | undefined, kind?: string, id?: string): ApplicationPersistenceCorrelation | undefined {
  return context?.operationId ? { operationId: context.operationId, boundaryId: uuidv4(), targets: kind && id ? [{ kind, id }] : [] } : undefined
}

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

  async renameLibrary(libraryId: string, name: string, context?: AssetOperationContext): Promise<Record<string, unknown>> {
    const library = await renameAssetLibrary(libraryId, name, persistence(context, 'asset.library', libraryId))
    return { ...library }
  },

  async inspectLibrary(libraryId: string): Promise<AssetLibrarySnapshot> {
    return await inspectAssetLibrary(libraryId)
  },

  async createLibrary(name: string, context?: AssetOperationContext): Promise<Record<string, unknown>> {
    return { ...await createAssetLibrary(name, persistence(context)) }
  },

  async deleteLibrary(libraryId: string, context?: AssetOperationContext): Promise<Record<string, unknown>> {
    await deleteAssetLibrary(libraryId, persistence(context, 'asset.library', libraryId))
    return { libraryId, status: 'deleted' }
  },

  async restoreLibrary(snapshot: AssetLibrarySnapshot, context?: AssetOperationContext): Promise<Record<string, unknown>> {
    return { ...await restoreAssetLibrary(snapshot, persistence(context, 'asset.library', snapshot.id)) }
  },

  async listTags(): Promise<string[]> {
    return await listAssetTags()
  },

  async select(assetId: string | null): Promise<Record<string, unknown>> {
    useAssetLibraryStore.getState().setSelectedAsset(assetId ? await inspectAsset(assetId) : null)
    return { assetId }
  },

  async replaceTags(assetId: string, tags: string[], context?: AssetOperationContext): Promise<Record<string, unknown>> {
    const asset = await setAssetTags(assetId, tags, persistence(context, 'asset', assetId))
    return { assetId: asset.id, tags: asset.tags, revision: asset.updatedAt }
  },

  async rename(assetId: string, displayName: string, context?: AssetOperationContext): Promise<Record<string, unknown>> {
    const asset = await updateAsset(assetId, displayName, persistence(context, 'asset', assetId))
    return { assetId: asset.id, displayName: asset.displayName, revision: asset.updatedAt }
  },

  async addToLibrary(libraryId: string, assetId: string, context?: AssetOperationContext): Promise<Record<string, unknown>> {
    await addAssetToLibrary(libraryId, assetId, persistence(context, 'asset', assetId))
    return { libraryId, assetId, status: 'added' }
  },

  async removeFromLibrary(libraryId: string, assetId: string, context?: AssetOperationContext): Promise<Record<string, unknown>> {
    await removeAssetFromLibrary(libraryId, assetId, persistence(context, 'asset', assetId))
    return { libraryId, assetId, status: 'removed' }
  },

  async delete(assetId: string, context?: AssetOperationContext): Promise<Record<string, unknown>> {
    await deleteAsset(assetId, persistence(context, 'asset', assetId))
    if (useAssetLibraryStore.getState().selectedAsset?.id === assetId) {
      useAssetLibraryStore.getState().setSelectedAsset(null)
    }
    return { assetId, status: 'deleted' }
  },
}
