import { createAsset } from '@/commands/assetLibrary'
import { createLogger } from '@/core/logging'
import type { AssetMediaType, AssetRecord, AssetSource } from '@/platform/contracts/assetLibrary'

const logger = createLogger('features.assets.collection')

export interface CollectMediaReferenceInput {
  filePath: string
  mediaType: AssetMediaType
  source: AssetSource
  displayName?: string
  libraryIds?: string[]
}

export function resolveLocalAssetPath(source: string | null | undefined): string | null {
  const value = source?.trim()
  if (!value || /^(blob:|data:|https?:)/i.test(value)) return null
  if (/^henji-media:\/\/local\//i.test(value)) {
    try {
      return decodeURIComponent(new URL(value).pathname.replace(/^\//, ''))
    } catch {
      return null
    }
  }
  if (/^file:/i.test(value)) {
    try {
      const pathname = decodeURIComponent(new URL(value).pathname)
      return /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : pathname
    } catch {
      return null
    }
  }
  return value
}

export async function addMediaReferenceToLibrary(input: CollectMediaReferenceInput): Promise<AssetRecord> {
  const filePath = input.filePath.trim()
  if (!filePath || /^(blob:|data:|https?:)/i.test(filePath)) {
    throw new Error('只能收录已落盘的本地媒体文件')
  }
  logger.info('开始收录资产', { event: 'asset.collection.start', mediaType: input.mediaType, source: input.source })
  try {
    const asset = await createAsset({ ...input, filePath })
    logger.info('资产收录完成', { event: 'asset.collection.completed', assetId: asset.id, mediaType: asset.mediaType })
    return asset
  } catch (cause) {
    logger.error('资产收录失败', cause, { event: 'asset.collection.failed', mediaType: input.mediaType, source: input.source })
    throw cause
  }
}
