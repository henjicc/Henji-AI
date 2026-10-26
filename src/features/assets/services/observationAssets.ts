import { deleteAsset, queryAssets, setAssetTags, touchAsset } from '@/commands/assetLibrary'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform'
import type { AssetQueryInput, AssetRecord, AssetSource } from '@/platform/contracts/assetLibrary'
import { addMediaReferenceToLibrary } from './assetCollectionService'

const logger = createLogger('features.assets.observations')

/**
 * 助手观察图（剪辑取帧、联系表、应用界面截图）是自动生成、只供助手当下查看的图片。登记时打上这个标签，
 * 只保留最近用过的 OBSERVATION_KEEP_COUNT 张、且不超过 OBSERVATION_KEEP_DAYS 天；其余删除记录，文件交给媒体回收
 * （仍被文档引用的文件不会删）。用户把它加进素材库、或打了别的标签，就当作要留下的，不清理。
 */
export const OBSERVATION_ASSET_TAG = '助手观察'
export const OBSERVATION_KEEP_COUNT = 200
export const OBSERVATION_KEEP_DAYS = 7
const DAY_MS = 86_400_000
const PAGE_SIZE = 200
const PRUNE_INTERVAL_MS = 60_000
const LEGACY_FLAG = 'assets.observation.legacyTagged.v1'

/** 有标签之前（2026-10-27 前）生成的观察图：按生成时固定的名称认出来，只认没进素材库、没打标签的。 */
export function isLegacyObservation(asset: AssetRecord): boolean {
  if (asset.mediaType !== 'image' || asset.tags.length || asset.libraryIds.length) return false
  return asset.source === 'video-edit' && /(?:观察|联系表|参考比较)$/.test(asset.displayName)
    || asset.source === 'generated' && /-observation\.png$/.test(asset.displayName)
}

/** 登记一张观察图：新图打标签；同内容的已有观察图只刷新使用时间（内容寻址，同一画面复用同一条记录）。 */
export async function collectObservationImage(input: { filePath: string; displayName: string; source: AssetSource }): Promise<AssetRecord> {
  const asset = await addMediaReferenceToLibrary({ ...input, mediaType: 'image' })
  if (!asset.wasExisting) await setAssetTags(asset.id, [OBSERVATION_ASSET_TAG])
  else if (asset.tags.includes(OBSERVATION_ASSET_TAG)) await touchAsset(asset.id)
  scheduleObservationPrune()
  return asset
}

async function* assetPages(query: AssetQueryInput): AsyncGenerator<AssetRecord> {
  for (let page = 1; ; page++) {
    const result = await queryAssets({ ...query, page, pageSize: PAGE_SIZE })
    yield* result.items
    if (!result.items.length || page * PAGE_SIZE >= result.total) return
  }
}

/** 一次性给旧观察图补标签，之后按同一规则清理。 */
async function tagLegacyObservations(): Promise<number> {
  try { if (localStorage.getItem(LEGACY_FLAG)) return 0 } catch { return 0 }
  const found = new Map<string, AssetRecord>()
  for (const keyword of ['观察', '联系表', '参考比较', 'observation']) {
    for await (const asset of assetPages({ keyword, mediaType: 'image' })) if (isLegacyObservation(asset)) found.set(asset.id, asset)
  }
  for (const asset of found.values()) await setAssetTags(asset.id, [OBSERVATION_ASSET_TAG])
  try { localStorage.setItem(LEGACY_FLAG, '1') } catch { /* 下次再补，补标签可重复执行 */ }
  return found.size
}

/** 按保留规则清理观察图，返回删除的记录数。 */
export async function pruneObservationAssets(now = Date.now()): Promise<number> {
  const legacy = await tagLegacyObservations()
  const recency = (asset: AssetRecord): number => Math.max(asset.createdAt, asset.lastUsedAt ?? 0)
  const owned: AssetRecord[] = []
  for await (const asset of assetPages({ tag: OBSERVATION_ASSET_TAG })) {
    if (!asset.libraryIds.length && asset.tags.every(tag => tag === OBSERVATION_ASSET_TAG)) owned.push(asset)
  }
  owned.sort((a, b) => recency(b) - recency(a))
  const stale = owned.filter((asset, index) => index >= OBSERVATION_KEEP_COUNT || now - recency(asset) > OBSERVATION_KEEP_DAYS * DAY_MS)
  for (const asset of stale) await deleteAsset(asset.id)
  const files = stale.map(asset => asset.filePath).filter(file => /^(?:[A-Za-z]:[\\/]|\/)/.test(file))
  if (files.length) await getPlatform().media.enqueueRecycle(files)
  logger.info('助手观察图清理完成', { event: 'assets.observation.pruned', context: { kept: owned.length - stale.length, removed: stale.length, legacyTagged: legacy } })
  return stale.length
}

let pruning: Promise<unknown> | undefined
let lastPrune = 0
/** 每次登记后在后台清理，一分钟最多一次。 */
export function scheduleObservationPrune(): void {
  if (pruning || Date.now() - lastPrune < PRUNE_INTERVAL_MS) return
  lastPrune = Date.now()
  pruning = pruneObservationAssets()
    .catch(error => logger.warn('助手观察图清理未完成', { event: 'assets.observation.prune_failed', error }))
    .finally(() => { pruning = undefined })
}
