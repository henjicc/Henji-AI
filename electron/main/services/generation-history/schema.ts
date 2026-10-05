import type Database from 'better-sqlite3'

/*
 * 生成记录表（迁移账本第 5 项），唯一读写入口是同目录的 store.ts。
 *
 * - 多个结果存在 `result_paths`（JSON 字符串数组，按输出顺序），取代旧版 `file_path` 里用 `|||` 拼接的一列。
 * - `history_fts` 是提示词的全文索引（FTS5 trigram，支持中文子串），由触发器与 history 保持同步。
 * - 2.3 之前的库：旧表整表重建为新结构，`file_path` 拆成数组，其余列与行原样保留；
 *   路径本身的写法由第 14 项 stored_locations 统一换成位置写法。
 */

export const GENERATION_HISTORY_TABLE = 'history'
export const GENERATION_HISTORY_FTS_TABLE = 'history_fts'
export const RESULT_PATH_SEPARATOR_LEGACY = '|||'

const COLUMNS_SQL = `
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  type TEXT NOT NULL,
  prompt TEXT,
  params TEXT NOT NULL,
  result_paths TEXT NOT NULL DEFAULT '[]',
  task_id TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  cost REAL,
  duration INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
`

function tableColumns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
}

/** 旧版 `|||` 拼接的结果列拆成数组（去空白、去空段）。 */
export function splitLegacyResultPaths(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split(RESULT_PATH_SEPARATOR_LEGACY).map((item) => item.trim()).filter(Boolean)
}

function createIndexesAndSearch(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_history_created_at ON ${GENERATION_HISTORY_TABLE}(created_at DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS ${GENERATION_HISTORY_FTS_TABLE} USING fts5(
      prompt, content='${GENERATION_HISTORY_TABLE}', content_rowid='rowid', tokenize='trigram'
    );
    CREATE TRIGGER IF NOT EXISTS history_fts_after_insert AFTER INSERT ON ${GENERATION_HISTORY_TABLE} BEGIN
      INSERT INTO ${GENERATION_HISTORY_FTS_TABLE}(rowid, prompt) VALUES (new.rowid, new.prompt);
    END;
    CREATE TRIGGER IF NOT EXISTS history_fts_after_delete AFTER DELETE ON ${GENERATION_HISTORY_TABLE} BEGIN
      INSERT INTO ${GENERATION_HISTORY_FTS_TABLE}(${GENERATION_HISTORY_FTS_TABLE}, rowid, prompt) VALUES ('delete', old.rowid, old.prompt);
    END;
    CREATE TRIGGER IF NOT EXISTS history_fts_after_update AFTER UPDATE OF prompt ON ${GENERATION_HISTORY_TABLE} BEGIN
      INSERT INTO ${GENERATION_HISTORY_FTS_TABLE}(${GENERATION_HISTORY_FTS_TABLE}, rowid, prompt) VALUES ('delete', old.rowid, old.prompt);
      INSERT INTO ${GENERATION_HISTORY_FTS_TABLE}(rowid, prompt) VALUES (new.rowid, new.prompt);
    END;
  `)
  db.exec(`INSERT INTO ${GENERATION_HISTORY_FTS_TABLE}(${GENERATION_HISTORY_FTS_TABLE}) VALUES ('rebuild')`)
}

/** 旧表有数据时迁移前备份（整表重建）。 */
export function generationHistoryNeedsBackup(db: Database.Database): boolean {
  const columns = tableColumns(db, GENERATION_HISTORY_TABLE)
  if (!columns.includes('file_path')) return false
  return Boolean(db.prepare(`SELECT 1 FROM ${GENERATION_HISTORY_TABLE} LIMIT 1`).get())
}

export function createGenerationHistoryTablesV1(db: Database.Database): void {
  const columns = tableColumns(db, GENERATION_HISTORY_TABLE)
  if (columns.length === 0) {
    db.exec(`CREATE TABLE ${GENERATION_HISTORY_TABLE} (${COLUMNS_SQL})`)
    createIndexesAndSearch(db)
    return
  }
  if (!columns.includes('file_path')) {
    // 已是新结构（例如账本被手工清理后重放），只补索引与全文检索。
    createIndexesAndSearch(db)
    return
  }
  // 旧结构：整表重建。旧版从未建过 history_fts；保险起见先清掉同名残留。
  db.exec(`DROP TABLE IF EXISTS ${GENERATION_HISTORY_FTS_TABLE}`)
  db.exec(`CREATE TABLE history_v2 (${COLUMNS_SQL})`)
  const keep = ['id', 'provider_id', 'model_id', 'type', 'prompt', 'params', 'task_id', 'status', 'error_message', 'cost', 'duration', 'created_at', 'updated_at']
  const present = keep.filter((name) => columns.includes(name))
  const select = db.prepare(`SELECT ${present.join(', ')}, file_path FROM ${GENERATION_HISTORY_TABLE} ORDER BY rowid`)
  const insert = db.prepare(`INSERT INTO history_v2 (${present.join(', ')}, result_paths) VALUES (${present.map(() => '?').join(', ')}, ?)`)
  // better-sqlite3 迭代期间不能执行其他语句，先整表读出（单表记录量在万级以内）。
  for (const row of select.all() as Array<Record<string, unknown>>) {
    const values = present.map((name) => {
      const value = row[name]
      // 旧行的 params 可能为空：新结构要求非空 JSON。
      if (name === 'params') return typeof value === 'string' && value.trim() ? value : '{}'
      return value ?? null
    })
    const legacy = typeof row.file_path === 'string' ? row.file_path : null
    insert.run(...values, JSON.stringify(splitLegacyResultPaths(legacy)))
  }
  db.exec(`DROP TABLE ${GENERATION_HISTORY_TABLE}`)
  db.exec(`ALTER TABLE history_v2 RENAME TO ${GENERATION_HISTORY_TABLE}`)
  createIndexesAndSearch(db)
}
