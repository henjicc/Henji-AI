import { createLogger } from '@/core/logging'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { assetApplicationService } from './assetApplicationService'

const logger = createLogger('features.assets.batch')
const BATCH_CONCURRENCY = 4

export interface AssetBatchFailure {
  assetId: string
  message: string
}

export interface AssetBatchResult {
  succeededIds: string[]
  failures: AssetBatchFailure[]
}

async function runAssetBatch(
  operation: string,
  assets: AssetRecord[],
  execute: (asset: AssetRecord) => Promise<unknown>,
): Promise<AssetBatchResult> {
  const queue = [...assets]
  const succeededIds: string[] = []
  const failures: AssetBatchFailure[] = []
  logger.info('批量资产操作开始', { event: 'asset.batch.started', operation, count: assets.length })

  const worker = async (): Promise<void> => {
    for (;;) {
      const asset = queue.shift()
      if (!asset) return
      try {
        await execute(asset)
        succeededIds.push(asset.id)
      } catch (cause) {
        failures.push({ assetId: asset.id, message: cause instanceof Error ? cause.message : String(cause) })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, assets.length) }, () => worker()))
  if (failures.length > 0) {
    logger.error('批量资产操作部分失败', new Error(`${failures.length} assets failed`), {
      event: 'asset.batch.partial_failed',
      context: { operation, count: assets.length, succeeded: succeededIds.length, failed: failures.length },
    })
  } else {
    logger.info('批量资产操作完成', { event: 'asset.batch.completed', operation, count: assets.length })
  }
  return { succeededIds, failures }
}

export function updateAssetTagsBatch(assets: AssetRecord[], tags: string[], mode: 'add' | 'remove'): Promise<AssetBatchResult> {
  const normalizedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
  return runAssetBatch(`tags.${mode}`, assets, async (asset) => {
    const nextTags = mode === 'add'
      ? [...new Set([...asset.tags, ...normalizedTags])]
      : asset.tags.filter((tag) => !normalizedTags.includes(tag))
    if (nextTags.length === asset.tags.length && nextTags.every((tag, index) => tag === asset.tags[index])) return
    await assetApplicationService.replaceTags(asset.id, nextTags)
  })
}

export function updateAssetLibraryBatch(assets: AssetRecord[], libraryId: string, mode: 'add' | 'remove'): Promise<AssetBatchResult> {
  return runAssetBatch(`library.${mode}`, assets, async (asset) => {
    const included = asset.libraryIds.includes(libraryId)
    if ((mode === 'add' && included) || (mode === 'remove' && !included)) return
    if (mode === 'add') await assetApplicationService.addToLibrary(libraryId, asset.id)
    else await assetApplicationService.removeFromLibrary(libraryId, asset.id)
  })
}

export function deleteAssetsBatch(assets: AssetRecord[]): Promise<AssetBatchResult> {
  return runAssetBatch('delete', assets, (asset) => assetApplicationService.delete(asset.id))
}
