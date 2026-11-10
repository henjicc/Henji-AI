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

/*
 * 第 27 项迁移冻结的入队条件：清存量与建触发器共用这一份，保证两者同源。以后需要改条件时在新迁移里另写一份，不改这里。
 *
 * 判断的是“旧值里有没有任何路径样字符串”，而不是受管根前缀：库里并存 `henji://` 相对写法与正反斜杠绝对路径，
 * 作品目录可更换、归属要经 realpath 才能确定，静态 SQL 写不出不漏判的前缀。起始字符与回收端
 * `collectMediaReferences` 一致（盘符、斜杠、`file:`、`henji:`、`henji-media:`），是它的超集；漏判只会少回收，不会错删。
 * LIKE 对 ASCII 不分大小写，与回收端正则的 /i 一致；值为 NULL 时条件为 NULL，触发器不触发。
 */
const BACKSLASH = 'char(92)'
/** JSON 文本里有以路径开头的字符串（值或键）：JSON.stringify 的字符串以 `"` 开头，反斜杠写成两个。 */
const jsonHasPathV27 = (x: string): string => `(${x} LIKE '%"henji:%' OR ${x} LIKE '%"henji-media:%' OR ${x} LIKE '%"file:%'
  OR ${x} LIKE '%"/%' OR ${x} LIKE '%"' || ${BACKSLASH} || ${BACKSLASH} || '%' OR ${x} GLOB '*"[A-Za-z]:[/' || ${BACKSLASH} || ']*')`
/** 整列本身就是一个路径。 */
const isPathV27 = (x: string): string => `(${x} LIKE 'henji:%' OR ${x} LIKE 'henji-media:%' OR ${x} LIKE 'file:%'
  OR ${x} LIKE '/%' OR ${x} LIKE ${BACKSLASH} || '%' OR ${x} GLOB '[A-Za-z]:[/' || ${BACKSLASH} || ']*')`

type ColumnV27 = (name: string) => string
interface GuardV27 { columns: string[]; holds: (c: ColumnV27) => string; release: string; partial?: boolean }
const singleJsonV27 = (column: string): GuardV27 => ({
  columns: [column],
  holds: c => jsonHasPathV27(c(column)),
  release: `OLD.${column} IS NOT NEW.${column} AND ${jsonHasPathV27(`OLD.${column}`)}`,
})
/**
 * holds：一行（或删除时的旧行）可能持有引用，用于 DELETE 触发器与清存量。
 * release：UPDATE 时某个承载引用的列既变了、旧值又可能含路径。
 * partial：UPDATE 载荷里没变的列写 NULL——没变的列仍被这一行引用，写进候选只会让它永远“仍被引用”。
 */
const MEDIA_RECYCLE_GUARDS_V27: Readonly<Record<string, GuardV27>> = {
  // id 对应程序目录里的 EditStates/<id>.json，删除历史一律入队。
  history: {
    columns: ['params', 'result_paths', 'id'], partial: true,
    holds: () => '1',
    release: `(OLD.params IS NOT NEW.params AND ${jsonHasPathV27('OLD.params')}) OR (OLD.result_paths IS NOT NEW.result_paths AND ${jsonHasPathV27('OLD.result_paths')}) OR OLD.id IS NOT NEW.id`,
  },
  presets: singleJsonV27('params'),
  assets: {
    columns: ['file_path', 'thumbnail_name'], partial: true,
    holds: c => `(${isPathV27(c('file_path'))} OR ${c('thumbnail_name')} IS NOT NULL)`,
    release: `(OLD.file_path IS NOT NEW.file_path AND ${isPathV27('OLD.file_path')}) OR (OLD.thumbnail_name IS NOT NEW.thumbnail_name AND OLD.thumbnail_name IS NOT NULL)`,
  },
  // 已交接给历史的回执不再持有；交接本身（新行变为已交接）即使 response_json 没变也要入队。
  generation_submissions: {
    columns: ['response_json', 'phase', 'media_released'],
    holds: c => `(NOT (${c('media_released')} = 1 AND ${c('phase')} = 'completed') AND ${jsonHasPathV27(c('response_json'))})`,
    release: `NOT (OLD.media_released = 1 AND OLD.phase = 'completed') AND ${jsonHasPathV27('OLD.response_json')}
      AND (OLD.response_json IS NOT NEW.response_json OR (NEW.media_released = 1 AND NEW.phase = 'completed'))`,
  },
  pending_task_results: singleJsonV27('result_json'),
  camera_stage_render_tasks: singleJsonV27('record_json'),
  audio_edit_tasks: singleJsonV27('result_json'),
  // 不看 type：字符串设置的整值可能是路径，json 设置里可能含路径，取超集。
  settings: {
    columns: ['value', 'type'],
    holds: c => `(${isPathV27(c('value'))} OR ${jsonHasPathV27(c('value'))})`,
    release: `OLD.value IS NOT NEW.value AND (${isPathV27('OLD.value')} OR ${jsonHasPathV27('OLD.value')})`,
  },
  application_invocations: singleJsonV27('record_json'),
  application_observations: singleJsonV27('record_json'),
}

/**
 * 第 27 项迁移专用（条件冻结，见上）：回收候选只在旧行可能含媒体路径时入队，并清掉不含任何路径的存量候选与已搬出设置表的剪辑缓存。
 * 删的是回收意图与可重建缓存，不是用户数据，所以不做整库备份。
 */
export function guardMediaRecycleOutbox(db: Database.Database): void {
  for (const table of Object.keys(MEDIA_RECYCLE_GUARDS_V27)) db.exec(`DROP TRIGGER IF EXISTS media_recycle_${table}_update; DROP TRIGGER IF EXISTS media_recycle_${table}_delete;`)
  // 代码素材参数缓存与播放性能观测已移到程序目录；此时没有回收触发器，删除不产生候选。
  db.exec("DELETE FROM settings WHERE key GLOB 'cache.video-edit.*'")
  const fromPayload: ColumnV27 = name => `json_extract(payload, '$.${name}')`
  const old: ColumnV27 = name => `OLD.${name}`
  for (const [table, guard] of Object.entries(MEDIA_RECYCLE_GUARDS_V27)) {
    db.prepare(`DELETE FROM media_recycle_candidates WHERE source = ? AND NOT coalesce(${guard.holds(fromPayload)}, 0)`).run(table)
    const deletePayload = guard.columns.flatMap(column => [`'${column}'`, `OLD.${column}`]).join(', ')
    const updatePayload = guard.columns.flatMap(column => [`'${column}'`, guard.partial ? `CASE WHEN OLD.${column} IS NOT NEW.${column} THEN OLD.${column} END` : `OLD.${column}`]).join(', ')
    db.exec(`CREATE TRIGGER media_recycle_${table}_delete AFTER DELETE ON ${table} WHEN ${guard.holds(old)}
      BEGIN INSERT INTO media_recycle_candidates(source, payload) VALUES ('${table}', json_object(${deletePayload})); END`)
    db.exec(`CREATE TRIGGER media_recycle_${table}_update AFTER UPDATE OF ${guard.columns.join(', ')} ON ${table} WHEN ${guard.release}
      BEGIN INSERT INTO media_recycle_candidates(source, payload) VALUES ('${table}', json_object(${updatePayload})); END`)
  }
}
