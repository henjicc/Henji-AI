import { assetApplicationService } from '@/features/assets/application/assetApplicationService'

import type { ApplicationCapabilityHandlerRegistrar } from './handlerTypes'
import { parseCapabilityInput, throwIfCapabilityAborted } from './handlerUtils'
import { getHostScopeRevisions } from '../hostContext/hostContext'
import { configureAssetMutationDependencies } from './applicationControlRegistry'

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
    return await assetApplicationService.query(parsed)
  })

  registrar.registerHandler('get_asset', async (input) => {
    const parsed = parseCapabilityInput<{ assetId: string }>('get_asset', input)
    return { asset: await assetApplicationService.read(parsed.assetId) }
  })

  registrar.registerHandler('list_asset_libraries', async () => ({
    libraries: await assetApplicationService.listLibraries(),
  }))

  registrar.registerHandler('list_asset_tags', async () => ({
    tags: await assetApplicationService.listTags(),
  }))

  registrar.registerHandler('select_asset', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ assetId: string | null }>('select_asset', input)
    // 选中项只是瞬时 UI 状态，不是素材领域真相，不推进 optimistic revision。
    return await assetApplicationService.select(parsed.assetId)
  })

  registrar.registerHandler('set_asset_tags', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      assetId: string
      tags: string[]
    }>('set_asset_tags', input)
    return await assetApplicationService.replaceTags(parsed.assetId, parsed.tags)
  })

  configureAssetMutationDependencies({
    readRevision: () => getHostScopeRevisions().assets,
    // 所有正式素材写入都在 commands/assetLibrary 的唯一写边界发出领域变更信号。
    // 执行器不得再次 bump，否则一次写入会制造两个 revision 并放大后续冲突。
    bumpRevision: () => undefined,
  })
  registrar.registerHandler('add_asset_to_library', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      libraryId: string
      assetId: string
    }>('add_asset_to_library', input)
    return await assetApplicationService.addToLibrary(parsed.libraryId, parsed.assetId)
  })

  registrar.registerHandler('remove_asset_from_library', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      libraryId: string
      assetId: string
    }>('remove_asset_from_library', input)
    return await assetApplicationService.removeFromLibrary(parsed.libraryId, parsed.assetId)
  })

  registrar.registerHandler('delete_asset', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ assetId: string }>('delete_asset', input)
    return await assetApplicationService.delete(parsed.assetId)
  })
}
