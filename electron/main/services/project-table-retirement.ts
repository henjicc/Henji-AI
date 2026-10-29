import type Database from 'better-sqlite3'

/*
 * 工程 ID 无法映射到文档 ID，退役工程表时必须同时清理依附的回执。
 * 含数据的表通过 `backupWhen: tablesHaveRows(...)` 触发账本整库备份，保留恢复原始数据的途径。
 */

/** 表存在且至少有一行。 */
export function tableHasRows(db: Database.Database, table: string): boolean {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  if (!exists) return false
  return Boolean(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())
}

export function tablesHaveRows(...tables: string[]): (db: Database.Database) => boolean {
  return (db) => tables.some((table) => tableHasRows(db, table))
}

/**
 * 数据库版本 15：删除 camera_stage_projects，清空引用工程 ID 的 camera_stage_render_tasks 回执。
 * 新回执的 cameraStageDocumentId 指向镜头参考文档 ID，工程 ID 无法映射到文档 ID。
 */
export function retireCameraStageProjects(db: Database.Database): void {
  db.exec('DROP INDEX IF EXISTS idx_camera_stage_projects_updated_at')
  db.exec('DROP TABLE IF EXISTS camera_stage_projects')
  db.exec('DELETE FROM camera_stage_render_tasks')
}

export const cameraStageProjectsNeedBackup = tablesHaveRows('camera_stage_projects', 'camera_stage_render_tasks')

/**
 * 数据库版本 16：删除 audio_edit_projects，将 audio_edit_tasks 整表重建为按 document_id 归属。
 * 工程回执无法映射到文档，必须清空；重建后解除对工程表的级联外键，表结构只由迁移账本管理。
 */
export function retireAudioEditProjects(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_audio_edit_tasks_project;
    DROP TABLE IF EXISTS audio_edit_tasks;
    DROP INDEX IF EXISTS idx_audio_edit_projects_updated_at;
    DROP TABLE IF EXISTS audio_edit_projects;

    CREATE TABLE audio_edit_tasks (
      request_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      provider_task_id TEXT,
      input_digest TEXT NOT NULL,
      result_json TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_audio_edit_tasks_document
      ON audio_edit_tasks(document_id, updated_at DESC);
  `)
}

export const audioEditProjectsNeedBackup = tablesHaveRows('audio_edit_projects', 'audio_edit_tasks')

/**
 * 数据库版本 17：删除 storyboard_projects 和 canvas_projects，画布内容使用 .hjcvs 文档。
 * 工程内容没有文档迁移规则，含数据时先整库备份；从版本 17 起，账本之外不再建任何表。
 */
export function retireCanvasProjects(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_storyboard_projects_updated_at;
    DROP TABLE IF EXISTS storyboard_projects;
    DROP INDEX IF EXISTS idx_canvas_projects_updated_at;
    DROP TABLE IF EXISTS canvas_projects;
  `)
}

export const canvasProjectsNeedBackup = tablesHaveRows('storyboard_projects', 'canvas_projects')
