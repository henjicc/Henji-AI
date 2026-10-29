import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { shell } from 'electron'
import { getDb } from '../db'
import { databaseLocationContext } from '../db-locations'
import { createMainLogger } from '../logging/main-logger'
import { getProgramStoreDir } from '../appPaths'
import { listManagedMediaFileLeases } from '../image/managed-media-leases'
import { listUploadImageLeases } from '../image/path-utils'
import { collectUnreferencedMedia, type MediaReferenceProvider, type RecycleCandidate } from './collector'
import { managedMediaRoots } from './queue'
import { collectDocumentReferences, collectSqlReferences, decodeReferenceValues, recordReferences, releaseDocumentSubmissionReferences } from './providers'
import { assertMediaStorageCoverage, MEDIA_REFERENCE_TABLES } from './schema'
import { MediaRecycleDeadline } from './lifecycle'
import { createRecycleStore, type RecycleRow } from './store'
import type { LocationContext } from '../../../../src/core/storage/locationCodec'

const logger = createMainLogger('main.media_recycle')
const providers: MediaReferenceProvider[] = [
  { id: 'storage-coverage', collect: async () => { assertMediaStorageCoverage(getDb()); return [] } },
  ...Object.keys(MEDIA_REFERENCE_TABLES).map(id => ({ id, collect: (signal: AbortSignal) => collectSqlReferences(id as keyof typeof MEDIA_REFERENCE_TABLES, signal) })),
  { id: 'detached-documents', collect: async signal => {
    const paths = new Set<string>()
    for (const row of getDb().prepare('SELECT owner FROM media_recycle_retained').all() as Array<{ owner: string }>) {
      signal.throwIfAborted()
      const document = await collectDocumentReferences(signal, row.owner)
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
  // 历史缩略图沿用主文件名，两个尺寸都受主文件引用保护。
  const derivedFrom: Record<string, string[]> = {}
  for (const file of paths) {
    const name = path.basename(file).replace(/\.[^.]+$/, '.webp')
    for (const derived of [path.join(getProgramStoreDir('thumbnails'), name), path.join(getProgramStoreDir('thumbnails'), '540', name)]) (derivedFrom[derived] ??= []).push(file)
  }
  return { id: row.id, paths: [...new Set([...paths, ...Object.keys(derivedFrom)])], derivedFrom, protectedBy: row.source === 'paths' ? decodeReferenceValues(direct.protectedBy, context) : [] }
}

export async function runMediaRecycle(signal: AbortSignal): Promise<void> {
  let candidateCount = 0
  try {
    signal.throwIfAborted()
    const db = getDb()
    candidateCount = (db.prepare('SELECT count(*) AS n FROM media_recycle_candidates').get() as { n: number }).n
    if (!candidateCount) return
    assertMediaStorageCoverage(db)
    const referencesStartedAt = performance.now()
    logger.info('开始读取持久媒体引用', { event: 'media_recycle.references.start', context: { candidates: candidateCount } })
    const documents = await collectDocumentReferences(signal)
    await releaseDocumentSubmissionReferences(documents.references, signal)
    signal.throwIfAborted()
    const context = databaseLocationContext(db)
    const queue = createRecycleStore(db, signal, row => decodeCandidate(row, context))
    try { await collectUnreferencedMedia({
      providers: [...providers, { id: 'documents-and-saved-history', collect: async () => [...documents.references, ...documents.protection] }],
      roots: async () => managedMediaRoots(),
      revision: queue.revision,
      referencesReady: references => {
        queue.referencesReady(references)
        logger.info('持久媒体引用读取完成', { event: 'media_recycle.references.completed', context: { candidates: candidateCount, references: references.size, durationMs: performance.now() - referencesStartedAt } })
      },
      trashItem: file => shell.trashItem(file),
      store: queue.store,
      log: (phase, summary, error) => {
        const failure = error ?? queue.checkpointError()
        logger[phase === 'failed' || phase === 'deferred' || failure ? 'warn' : 'info']('媒体回收', { event: `media_recycle.sweep.${failure ? 'failed' : phase}`, context: { ...summary, remaining: queue.remaining() }, ...(failure ? { error: failure } : {}) })
      },
    }, signal) } finally { queue.dispose() }
  } catch (error) {
    if (error === signal.reason && error instanceof MediaRecycleDeadline) {
      logger.warn('引用普查未完成，候选留待下次静默窗口', { event: 'media_recycle.references.deferred', context: { candidates: candidateCount, deleted: 0 } })
    } else logger.warn('媒体回收未完成，保留候选', { event: 'media_recycle.sweep.failed', context: { candidates: candidateCount, deleted: 0, recycledBytes: 0, retained: { 'reference-scan-incomplete': candidateCount } }, error })
  }
}
