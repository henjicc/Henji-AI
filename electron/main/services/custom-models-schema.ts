import type Database from 'better-sqlite3'

/** 自定义模型表（迁移账本第 3 项），唯一读写入口是 custom-models.ts。2.3 之前已存在的表原样保留。 */
export function createCustomModelsTableV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      base_model TEXT,
      config TEXT NOT NULL,
      is_enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}
