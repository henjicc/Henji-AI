import path from 'node:path'
import { setImmediate as yieldToIO } from 'node:timers/promises'
import { collectMediaReferences } from '../../../../src/core/media/mediaReferences'
import { createLocationCodec, type LocationContext } from '../../../../src/core/storage/locationCodec'
import { DOCUMENT_KINDS } from '../../../../src/core/documents/kinds'
import { getDb } from '../db'
import { databaseLocationContext } from '../db-locations'
import { getProgramDataDir, getProgramStoreDir, getUserModelsLocation, getUserRootDir } from '../appPaths'
import { MEDIA_REFERENCE_TABLES } from './schema'
import { scanReferenceFiles, type ReferenceScanRoot } from './file-scanner'
import { canonicalPath, within } from './paths'
import { managedMediaRoots, overlapsManagedMediaRoot } from './queue'
import { createMainLogger } from '../logging/main-logger'

const logger = createMainLogger('main.media_recycle')

/** Save acknowledgement records the handoff even if the user removes the document
 * again before the next quiet window. This only retires references; never unlinks. */
export async function recordDocumentMediaPublished(file: string): Promise<void> {
  if (!getDb().prepare("SELECT 1 FROM generation_submissions WHERE media_released = 0 AND phase = 'completed' AND json_array_length(response_json, '$.filePaths') > 0 LIMIT 1").get()) return
  const signal = new AbortController().signal
  await releaseDocumentSubmissionReferences(await collectDocumentReferences(signal, file), signal)
}

/** Documents can receive results without a history row. Record that handoff before
 * the sweep so a later document deletion does not resurrect receipt ownership. */
export async function releaseDocumentSubmissionReferences(references: readonly string[], signal: AbortSignal): Promise<void> {
  const held = new Set<string>()
  for (const value of references) {
    signal.throwIfAborted()
    const key = await canonicalPath(value)
    if (key) held.add(key)
  }
  const db = getDb()
  const context = databaseLocationContext(db)
  let cursor = 0
  for (;;) {
    signal.throwIfAborted()
    const rows = db.prepare("SELECT rowid AS cursor, request_id, response_json FROM generation_submissions WHERE rowid > ? AND media_released = 0 AND phase = 'completed' ORDER BY rowid LIMIT 128").all(cursor) as Array<{ cursor: number; request_id: string; response_json: string | null }>
    if (!rows.length) return
    for (const row of rows) {
      cursor = row.cursor
      const response = JSON.parse(row.response_json ?? 'null') as { filePaths?: unknown } | null
      const outputs = decodeReferenceValues(response?.filePaths, context)
      if (!outputs.length) continue
      const keys = await Promise.all(outputs.map(canonicalPath))
      signal.throwIfAborted()
      if (keys.every(key => key && held.has(key))) db.prepare('UPDATE generation_submissions SET media_released = 1 WHERE request_id = ?').run(row.request_id)
    }
    await yieldToIO()
  }
}

export function decodeReferenceValues(values: unknown, context: LocationContext, source = 'paths', rowId?: string): string[] {
  const result = createLocationCodec(context).decodeContent(values)
  const unresolved = result.report.unresolved
  if (unresolved.some(item => item.reason !== 'unknown_project')) throw new Error('Unresolved stored media locations')
  if (unresolved.length) {
    if (context.projects.some(project => overlapsManagedMediaRoot(project.root))) throw new Error('Unresolved project overlaps managed media storage')
    logger.warn('媒体引用指向已移除项目，已跳过项目外部位置', { event: 'media_recycle.references.unknown_project', context: { source, rowId, projectIds: [...new Set(unresolved.map(item => item.projectId))], count: unresolved.length } })
  }
  const ignored = new Set(unresolved.map(item => item.value))
  return collectMediaReferences(result.content).filter(value => !ignored.has(value))
}

export function recordReferences(source: string, raw: Record<string, unknown>, context: LocationContext): string[] {
  const definition = MEDIA_REFERENCE_TABLES[source as keyof typeof MEDIA_REFERENCE_TABLES]
  if (!definition) throw new Error(`Unregistered media storage: ${source}`)
  if (source === 'generation_submissions' && raw.media_released === 1 && raw.phase === 'completed') return []
  const values: unknown[] = []
  if (source === 'settings' && raw.key === 'audio_capture.pending_files' && typeof raw.value === 'string') {
    const pending = JSON.parse(raw.value) as { files?: string[]; placements?: Record<string, { spliceId: string }> }
    for (const name of pending.files ?? []) {
      values.push(path.join(getUserRootDir(), '录音', path.basename(name)))
      const id = pending.placements?.[name]?.spliceId
      if (id && /^[\w-]+$/.test(id)) values.push(path.join(getUserRootDir(), '录音', `${id}.wav`))
    }
  }
  for (const key of definition.json) if (raw[key] !== null && raw[key] !== undefined) values.push(JSON.parse(String(raw[key])))
  for (const key of definition.paths) values.push(raw[key])
  if (source === 'settings' && raw.type === 'json' && typeof raw.value === 'string') values.push(JSON.parse(raw.value))
  if (source === 'assets' && raw.thumbnail_name) values.push(path.join(getProgramStoreDir('thumbnails'), String(raw.thumbnail_name)))
  if (source === 'history' && raw.id) values.push(path.join(getProgramDataDir(), 'EditStates', `${String(raw.id)}.json`))
  return decodeReferenceValues(values, context, source, String(raw.id ?? raw.request_id ?? raw.cursor ?? ''))
}

export async function collectSqlReferences(source: keyof typeof MEDIA_REFERENCE_TABLES, signal: AbortSignal): Promise<string[]> {
  const refs = new Set<string>()
  const context = databaseLocationContext(getDb())
  // Keyset pages bound scheduling cost, not product size. No synchronous iterator held over awaits.
  let cursor = 0
  for (;;) {
    signal.throwIfAborted()
    const rows = getDb().prepare(`SELECT rowid AS cursor, * FROM ${source} WHERE rowid > ? ORDER BY rowid LIMIT 128`).all(cursor) as Array<Record<string, unknown> & { cursor: number }>
    if (!rows.length) break
    for (const row of rows) { for (const value of recordReferences(source, row, context)) refs.add(value); cursor = row.cursor }
    await yieldToIO()
  }
  return [...refs]
}

/** Enumerate disk roots as well as the index: index refresh can be stale or partial. */
export async function collectDocumentReferences(signal: AbortSignal, onlyRoot?: string): Promise<string[]> {
  const db = getDb()
  const context = databaseLocationContext(db)
  const refs = new Set<string>()
  const documentExtensions = [...new Set([...DOCUMENT_KINDS.map(kind => kind.extension), '.henjipack'])]
  const exclude = onlyRoot ? [] : [...managedMediaRoots(), getUserModelsLocation().dir]
  const roots: ReferenceScanRoot[] = onlyRoot ? [{ path: onlyRoot }] : [
    { path: context.userRoot, extensions: documentExtensions, exclude },
    ...(db.prepare('SELECT path FROM document_external_locations').all() as Array<{ path: string }>).map(root => ({ ...root, extensions: documentExtensions })),
    ...(db.prepare('SELECT path FROM document_index_documents').all() as Array<{ path: string }>).map(root => ({ ...root, extensions: documentExtensions })),
    { path: path.join(getProgramStoreDir('documentStore'), 'session-state'), optional: true },
    // Orphan edit states are candidates, not independent reference owners.
    ...(db.prepare('SELECT id FROM history').all() as Array<{ id: string }>).map(row => ({ path: path.join(getProgramDataDir(), 'EditStates', `${row.id}.json`), optional: true })),
    { path: path.join(getProgramStoreDir('imageEditor'), 'documents'), optional: true },
  ]
  const extensions = [...documentExtensions, '.json']
  await scanReferenceFiles(roots, extensions, signal, async (file, values) => {
    const project = [...context.projects].sort((a, b) => b.root.length - a.root.length).find(project => within(project.root, file))
    const fileContext: LocationContext = { ...context, container: project ? { kind: 'project', projectId: project.id } : { kind: 'user' } }
    for (const value of decodeReferenceValues(values, fileContext)) refs.add(value)
  })
  return [...refs]
}
