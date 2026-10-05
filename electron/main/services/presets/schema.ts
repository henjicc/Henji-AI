import type Database from 'better-sqlite3'

/** 预设表（迁移账本第 4 项），唯一读写入口是同目录的 store.ts。2.3 之前已存在的表原样保留。 */
export function createPresetsTableV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      model_id TEXT,
      params TEXT NOT NULL,
      is_favorite INTEGER DEFAULT 0,
      use_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}
