import type Database from 'better-sqlite3'

/** One registration owns both the reference scan and transactional retirement outbox. */
export const MEDIA_REFERENCE_TABLES = {
  history: { json: ['params', 'result_paths'], paths: [], extras: ['id'] },
  presets: { json: ['params'], paths: [], extras: [] },
  assets: { json: [], paths: ['file_path'], extras: ['thumbnail_name'] },
  generation_submissions: { json: ['response_json'], paths: [], extras: ['phase', 'media_released'] },
  pending_task_results: { json: ['result_json'], paths: [], extras: [] },
  camera_stage_render_tasks: { json: ['record_json'], paths: [], extras: [] },
  audio_edit_tasks: { json: ['result_json'], paths: [], extras: [] },
  settings: { json: [], paths: ['value'], extras: ['type'] },
  application_invocations: { json: ['record_json'], paths: [], extras: [] },
  application_observations: { json: ['record_json'], paths: [], extras: [] },
} as const

/** The document provider owns these path-bearing indexes; trace JSON is diagnostic,
 * not a restorable media owner. Every newly added *_json/path column needs a decision. */
const OTHER_STORAGE_PROVIDERS: Readonly<Record<string, string>> = {
  document_index_projects: 'documents-and-saved-history',
  document_index_documents: 'documents-and-saved-history',
  document_external_locations: 'documents-and-saved-history',
  application_model_traces: 'diagnostic-only: records do not restore media',
  assistant_memory: 'not a media owner: one-sentence entries plus font/style/voice/aspect defaults, no file fields',
  media_recycle_candidates: 'retirement intent, not a media root',
  media_recycle_owned: 'ownership provenance, not a media root',
  media_recycle_retained: 'detached-documents',
}

export function assertMediaStorageCoverage(db: Database.Database): void {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as Array<{ name: string }>
  for (const { name } of tables) {
    if (name in MEDIA_REFERENCE_TABLES || name in OTHER_STORAGE_PROVIDERS) continue
    const columns = db.prepare('SELECT name FROM pragma_table_info(?)').all(name) as Array<{ name: string }>
    if (columns.some(column => /(?:^|_)(?:path|paths|\w+_json)$/.test(column.name))) throw new Error(`Missing media reference provider: ${name}`)
  }
}

export function createMediaRecycleTablesV21(db: Database.Database): void {
  db.exec(`
    ALTER TABLE generation_submissions ADD COLUMN media_released INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX media_recycle_submission_pending ON generation_submissions(media_released, phase);
    CREATE TABLE media_recycle_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE media_recycle_owned (
      path TEXT PRIMARY KEY,
      identity TEXT NOT NULL,
      source_path TEXT
    );
    CREATE TABLE media_recycle_retained (
      owner TEXT PRIMARY KEY
    );
  `)
  // The durable receipt still provides idempotency, but ownership transfers to history.
  // Persist the handoff: checking only whether history exists during a later sweep
  // would resurrect receipt references immediately after deleting that history.
  const handoff = (filter: string): string => `UPDATE generation_submissions SET media_released = 1
    WHERE media_released = 0 AND phase = 'completed' AND (${filter})
      AND EXISTS (SELECT 1 FROM json_each(response_json, '$.filePaths'))
      AND NOT EXISTS (
        SELECT 1 FROM json_each(response_json, '$.filePaths') AS output
        WHERE NOT EXISTS (
          SELECT 1 FROM history, json_each(history.result_paths) AS result
          WHERE result.value = output.value
        )
      );`
  for (const action of ['INSERT', 'UPDATE OF result_paths']) {
    db.exec(`CREATE TRIGGER media_handoff_history_${action === 'INSERT' ? 'insert' : 'update'}
      AFTER ${action} ON history BEGIN ${handoff("EXISTS (SELECT 1 FROM json_each(response_json, '$.filePaths') AS output, json_each(NEW.result_paths) AS added WHERE output.value = added.value)")} END`)
  }
  for (const action of ['INSERT', 'UPDATE OF response_json, phase']) {
    db.exec(`CREATE TRIGGER media_handoff_submission_${action === 'INSERT' ? 'insert' : 'update'}
      AFTER ${action} ON generation_submissions BEGIN ${handoff('request_id = NEW.request_id')} END`)
  }
  for (const [table, fields] of Object.entries(MEDIA_REFERENCE_TABLES)) {
    const columns = [...fields.json, ...fields.paths, ...fields.extras]
    const payload = columns.flatMap(column => [`'${column}'`, `OLD.${column}`]).join(', ')
    for (const action of ['DELETE', `UPDATE OF ${columns.join(', ')}`]) {
      const name = action === 'DELETE' ? 'delete' : 'update'
      db.exec(`CREATE TRIGGER media_recycle_${table}_${name} AFTER ${action} ON ${table}
        BEGIN INSERT INTO media_recycle_candidates(source, payload) VALUES ('${table}', json_object(${payload})); END`)
    }
  }
}
