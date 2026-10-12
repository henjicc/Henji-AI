import path from 'node:path'
import { setImmediate as yieldToIO } from 'node:timers/promises'
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

const logger = createMainLogger('main.media_recycle')
const providers: MediaReferenceProvider[] = [
  { id: 'storage-coverage', collect: async () => { assertMediaStorageCoverage(getDb()); return [] } },
  ...Object.keys(MEDIA_REFERENCE_TABLES).map(id => ({ id, collect: (signal: AbortSignal) => collectSqlReferences(id as keyof typeof MEDIA_REFERENCE_TABLES, signal) })),
  { id: 'detached-documents', collect: async signal => {
    const paths = new Set<string>()
    for (const row of getDb().prepare('SELECT owner FROM media_recycle_retained').all() as Array<{ owner: string }>) {
      signal.throwIfAborted()
      for (const value of await collectDocumentReferences(signal, row.owner)) paths.add(value)
    }
    return paths
  } },
  { id: 'managed-leases', collect: async () => [...listManagedMediaFileLeases(), ...listUploadImageLeases()] },
]

async function* candidates(): AsyncIterable<RecycleCandidate> {
  let cursor = 0
  const context = databaseLocationContext(getDb())
  for (;;) {
    const rows = getDb().prepare('SELECT id, source, payload FROM media_recycle_candidates WHERE id > ? ORDER BY id LIMIT 128').all(cursor) as Array<{ id: number; source: string; payload: string }>
    if (!rows.length) return
    for (const row of rows) {
      cursor = row.id
      const raw: unknown = JSON.parse(row.payload)
      const direct = raw as { paths: string[]; protectedBy: string[] }
      const paths = row.source === 'paths' ? decodeReferenceValues(direct.paths, context) : recordReferences(row.source, raw as Record<string, unknown>, context)
      // Legacy history thumbnails are named after the primary file, in two resolutions.
      const derivedFrom: Record<string, string[]> = {}
      for (const file of paths) {
        const name = path.basename(file).replace(/\.[^.]+$/, '.webp')
        for (const derived of [path.join(getProgramStoreDir('thumbnails'), name), path.join(getProgramStoreDir('thumbnails'), '540', name)]) (derivedFrom[derived] ??= []).push(file)
      }
      yield { id: row.id, paths: [...new Set([...paths, ...Object.keys(derivedFrom)])], derivedFrom, protectedBy: row.source === 'paths' ? decodeReferenceValues(direct.protectedBy, context) : [] }
    }
    await yieldToIO()
  }
}

export async function runMediaRecycle(signal: AbortSignal): Promise<void> {
  let candidateCount = 0
  try {
    candidateCount = (getDb().prepare('SELECT count(*) AS n FROM media_recycle_candidates').get() as { n: number }).n
    if (!candidateCount) return
    assertMediaStorageCoverage(getDb())
    logger.info('开始读取持久媒体引用', { event: 'media_recycle.references.start', context: { candidates: candidateCount } })
    const documents = await collectDocumentReferences(signal)
    await releaseDocumentSubmissionReferences(documents, signal)
    logger.info('持久媒体引用读取完成', { event: 'media_recycle.references.completed', context: { candidates: candidateCount } })
    await collectUnreferencedMedia({
      providers: [...providers, { id: 'documents-and-saved-history', collect: async () => documents }],
      roots: async () => managedMediaRoots(),
      revision: () => String((getDb().prepare('SELECT total_changes() AS n').get() as { n: number }).n),
      store: {
        count: () => (getDb().prepare('SELECT count(*) AS n FROM media_recycle_candidates').get() as { n: number }).n,
        candidates,
        identity: file => (getDb().prepare('SELECT identity FROM media_recycle_owned WHERE path = ?').get(file) as { identity: string } | undefined)?.identity,
        protector: file => (getDb().prepare('SELECT source_path FROM media_recycle_owned WHERE path = ?').get(file) as { source_path?: string } | undefined)?.source_path,
        forget: id => { getDb().prepare('DELETE FROM media_recycle_candidates WHERE id = ?').run(id) },
      },
      log: (phase, summary, error) => logger[phase === 'failed' ? 'warn' : 'info']('媒体回收', { event: `media_recycle.sweep.${phase}`, context: { ...summary }, ...(error ? { error } : {}) }),
    }, signal)
  } catch (error) { logger.warn('媒体回收未完成，保留候选', { event: 'media_recycle.sweep.failed', context: { candidates: candidateCount, deleted: 0, freedBytes: 0, retained: { 'documents-or-handoff': candidateCount } }, error }) }
}
