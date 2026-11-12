import path from 'node:path'
import fs from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { trashUserFile } from '../recycle/runtime'
import { getDb } from '../db'
import { databaseLocationContext } from '../db-locations'
import { createMainLogger } from '../logging/main-logger'
import { getProgramDataDir, getProgramStoreDir } from '../appPaths'
import { listManagedMediaFileLeases } from '../image/managed-media-leases'
import { listUploadImageLeases } from '../image/path-utils'
import { collectUnreferencedMedia, type MediaReferenceProvider, type RecycleCandidate } from './collector'
import { isManagedMediaClaimed, managedMediaRoots } from './queue'
import { collectDocumentReferences, collectSqlReferences, decodeReferenceValues, recordReferences, releaseDocumentSubmissionReferences } from './providers'
import { assertMediaStorageCoverage, MEDIA_REFERENCE_TABLES } from './schema'
import { MediaRecycleStopped } from './lifecycle'
import { createRecycleStore, type RecycleRow } from './store'
import type { LocationContext } from '../../../../src/core/storage/locationCodec'
import { legacyThumbnailCacheFileName, thumbnailCacheFileName } from '../../../../src/core/media/thumbnailCacheName'

const logger = createMainLogger('main.media_recycle')
const providers: MediaReferenceProvider[] = [
  { id: 'storage-coverage', collect: async () => { assertMediaStorageCoverage(getDb()); return [] } },
  ...Object.keys(MEDIA_REFERENCE_TABLES).map(id => ({ id, collect: (signal: AbortSignal) => collectSqlReferences(id as keyof typeof MEDIA_REFERENCE_TABLES, signal) })),
  { id: 'detached-documents', collect: async signal => {
    const paths = new Set<string>()
    for (const row of getDb().prepare('SELECT owner FROM media_recycle_retained').all() as Array<{ owner: string }>) {
      signal.throwIfAborted()
      const document = await collectDocumentReferences(signal, row.owner)
      // 卷在线而位置已不存在，它不会再引用任何媒体，退出登记；卷离线时读取直接失败，本轮不删。
      signal.throwIfAborted()
      if (document.missingRoots.length) getDb().prepare('DELETE FROM media_recycle_retained WHERE owner = ?').run(row.owner)
      for (const value of [...document.references, ...document.protection]) paths.add(value)
    }
    return paths
  } },
  { id: 'managed-leases', collect: async () => [...listManagedMediaFileLeases(), ...listUploadImageLeases()] },
]

function decodeCandidate(row: RecycleRow, context: LocationContext): RecycleCandidate {
  const raw: unknown = JSON.parse(row.payload)
  const direct = raw as { paths: string[]; protectedBy: string[] }
  const paths = row.source === 'paths' ? decodeReferenceValues(direct.paths, context) : recordReferences(row.source, raw as Record<string, unknown>, context)
  // 缩略图按主文件命名（当前带路径哈希，旧缓存只用主文件名），两个尺寸都受主文件引用保护。
  const derivedFrom: Record<string, string[]> = {}
  const thumbnails = getProgramStoreDir('thumbnails')
  for (const file of paths) {
    for (const name of new Set([thumbnailCacheFileName(file), legacyThumbnailCacheFileName(file)])) {
      for (const derived of [path.join(thumbnails, name), path.join(thumbnails, '540', name)]) (derivedFrom[derived] ??= []).push(file)
    }
  }
  return { id: row.id, paths: [...new Set([...paths, ...Object.keys(derivedFrom)])], derivedFrom, protectedBy: row.source === 'paths' ? decodeReferenceValues(direct.protectedBy, context) : [] }
}

/** 界面加载前的最后一个候选编号。之后入队的候选可能指向界面里还没保存的文件，留给下次启动。 */
export function readMediaRecycleHorizon(): number {
  return (getDb().prepare('SELECT max(id) AS id FROM media_recycle_candidates').get() as { id: number | null }).id ?? 0
}

export async function runMediaRecycle(signal: AbortSignal, horizon = readMediaRecycleHorizon()): Promise<void> {
  let candidateCount = 0
  const startedAt = performance.now()
  try {
    signal.throwIfAborted()
    const db = getDb()
    candidateCount = (db.prepare('SELECT count(*) AS n FROM media_recycle_candidates WHERE id <= ?').get(horizon) as { n: number }).n
    if (!candidateCount) {
      logger.info('没有待回收的媒体', { event: 'media_recycle.sweep.skipped', context: { reason: 'no-candidates' } })
      return
    }
    assertMediaStorageCoverage(db)
    logger.info('开始读取持久媒体引用', { event: 'media_recycle.references.start', context: { candidates: candidateCount } })
    const documents = await collectDocumentReferences(signal)
    await releaseDocumentSubmissionReferences(documents.references, signal)
    signal.throwIfAborted()
    const context = databaseLocationContext(db)
    const queue = createRecycleStore(db, signal, horizon, row => decodeCandidate(row, context))
    await collectUnreferencedMedia({
      providers: [...providers, { id: 'documents-and-saved-history', collect: async () => [...documents.references, ...documents.protection] }],
      roots: async () => managedMediaRoots(),
      referencesReady: references => {
        logger.info('持久媒体引用读取完成', { event: 'media_recycle.references.completed', context: { candidates: candidateCount, references: references.size, durationMs: Math.round(performance.now() - startedAt) } })
      },
      claimed: isManagedMediaClaimed,
      trashItem: async file => {
        const cacheRoots = [getProgramStoreDir('thumbnails'), path.join(getProgramDataDir(), 'EditStates')]
        if (cacheRoots.some(root => { const relative = path.relative(root, file); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) })) {
          // media-recycle-allow: 缓存已通过本回收器的归属、文件身份和引用核验。
          await fs.rm(file, { force: true })
        }
        else await trashUserFile(file)
      },
      store: queue.store,
      log: (phase, summary, error) => {
        const level = phase === 'failed' || phase === 'deferred' ? 'warn' : 'info'
        logger[level]('媒体回收', { event: `media_recycle.sweep.${phase}`, context: { ...summary, remaining: queue.remaining(), ...(phase === 'start' ? {} : { durationMs: Math.round(performance.now() - startedAt) }) }, ...(error ? { error } : {}) })
      },
    }, signal)
  } catch (error) {
    if (error === signal.reason && error instanceof MediaRecycleStopped) {
      logger.warn('引用普查未完成，候选留待下次启动', { event: 'media_recycle.references.deferred', context: { candidates: candidateCount, deleted: 0 } })
    } else logger.warn('媒体回收未完成，保留候选', { event: 'media_recycle.sweep.failed', context: { candidates: candidateCount, deleted: 0, recycledBytes: 0, retained: { 'reference-scan-incomplete': candidateCount } }, error })
  }
}
