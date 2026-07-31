import {
  addAssetToLibraryFromAgent,
  deleteAssetFromAgent,
  getAssetFromAgent,
  listAssetLibrariesFromAgent,
  listAssetTagsFromAgent,
  queryAssetsFromAgent,
  removeAssetFromLibraryFromAgent,
  selectAssetFromAgent,
  setAssetTagsFromAgent,
} from '@/features/assistant/hostActions'

import type { ApplicationCapabilityHandlerRegistrar } from './handlerTypes'
import { parseCapabilityInput, throwIfCapabilityAborted } from './handlerUtils'

interface AssetQueryInput {
  mediaType?: 'image' | 'video' | 'audio'
  libraryId?: string
  tag?: string
  keyword?: string
  page: number
  pageSize: number
  sort: 'created' | 'recent'
}

export function registerAssetCapabilityHandlers(
  registrar: ApplicationCapabilityHandlerRegistrar
): void {
  registrar.registerHandler('query_assets', async (input) => {
    const parsed = parseCapabilityInput<AssetQueryInput>('query_assets', input)
    return await queryAssetsFromAgent(parsed)
  })

  registrar.registerHandler('get_asset', async (input) => {
    const parsed = parseCapabilityInput<{ assetId: string }>('get_asset', input)
    return { asset: await getAssetFromAgent(parsed.assetId) }
  })

  registrar.registerHandler('list_asset_libraries', async () => ({
    libraries: await listAssetLibrariesFromAgent(),
  }))

  registrar.registerHandler('list_asset_tags', async () => ({
    tags: await listAssetTagsFromAgent(),
  }))

  registrar.registerHandler('select_asset', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ assetId: string | null }>('select_asset', input)
    return await selectAssetFromAgent(parsed.assetId)
  })

  registrar.registerHandler('set_asset_tags', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      assetId: string
      tags: string[]
    }>('set_asset_tags', input)
    return await setAssetTagsFromAgent(parsed.assetId, parsed.tags)
  })

  registrar.registerHandler('add_asset_to_library', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      libraryId: string
      assetId: string
    }>('add_asset_to_library', input)
    return await addAssetToLibraryFromAgent(parsed.libraryId, parsed.assetId)
  })

  registrar.registerHandler('remove_asset_from_library', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      libraryId: string
      assetId: string
    }>('remove_asset_from_library', input)
    return await removeAssetFromLibraryFromAgent(parsed.libraryId, parsed.assetId)
  })

  registrar.registerHandler('delete_asset', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ assetId: string }>('delete_asset', input)
    return await deleteAssetFromAgent(parsed.assetId)
  })
}
