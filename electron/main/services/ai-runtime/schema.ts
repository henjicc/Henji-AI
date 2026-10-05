import type Database from 'better-sqlite3'

/*
 * AI 运行时宿主拥有的表（迁移账本第 6、7、11 项）。2.3 之前已存在的表原样保留并补齐当时散写的补列。
 *
 * - progress_samples：progress.ts（生成耗时样本，估算进度）
 * - pending_task_results：pending-results.ts（完成但渲染层尚未确认的结果回执）
 * - generation_submissions：generation-submissions.ts（生成提交账本，防重复提交）
 */

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column)
}

export function createAiRuntimeTablesV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS progress_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      profile_key TEXT NOT NULL,
      time_bucket TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      started_at_ms INTEGER NOT NULL,
      finished_at_ms INTEGER NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_progress_samples_lookup
      ON progress_samples (model_id, profile_key, time_bucket, finished_at_ms DESC);
  `)
}

export function createPendingTaskResultsTableV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_task_results (
      server_task_id TEXT PRIMARY KEY,
      result_json TEXT NOT NULL,
      completed_at INTEGER NOT NULL
    )
  `)
}

export function createGenerationSubmissionsTableV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_submissions (
      request_id TEXT PRIMARY KEY,
      input_digest TEXT NOT NULL,
      response_json TEXT,
      created_at INTEGER NOT NULL,
      phase TEXT NOT NULL DEFAULT 'provider',
      model_id TEXT
    )
  `)
  // 2.3 之前按需补过的列：老库可能缺。
  if (!hasColumn(db, 'generation_submissions', 'phase')) db.exec("ALTER TABLE generation_submissions ADD COLUMN phase TEXT NOT NULL DEFAULT 'provider'")
  if (!hasColumn(db, 'generation_submissions', 'model_id')) db.exec('ALTER TABLE generation_submissions ADD COLUMN model_id TEXT')
}
