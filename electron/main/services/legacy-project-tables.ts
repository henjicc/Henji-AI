import type Database from 'better-sqlite3'

/*
 * 被文档文件取代的旧工程表的退役迁移（实施方案 2.9，重要记录 008、013）。
 *
 * 各工具接入文档底座（3.x）时在迁移账本末尾追加一项：删掉自己的旧工程表，旧内容不迁移；
 * 依附旧工程 ID 的回执一并清掉（新记录引用文档 ID，旧 ID 已无处可指）。
 * 迁移项声明 `backupWhen: legacyTablesHaveRows(...)`：库里确有旧数据时，执行前由账本整库备份到程序目录 backups/。
 */

/** 表存在且至少有一行。 */
export function legacyTableHasRows(db: Database.Database, table: string): boolean {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  if (!exists) return false
  return Boolean(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())
}

export function legacyTablesHaveRows(...tables: string[]): (db: Database.Database) => boolean {
  return (db) => tables.some((table) => legacyTableHasRows(db, table))
}

/**
 * 镜头参考（3.2）：删 `camera_stage_projects`；`camera_stage_render_tasks` 里的回执引用的是旧工程 ID，清空，
 * 之后新回执的 `cameraStageDocumentId` 是镜头参考文档的 ID。
 */
export function retireCameraStageProjectsV1(db: Database.Database): void {
  db.exec('DROP INDEX IF EXISTS idx_camera_stage_projects_updated_at')
  db.exec('DROP TABLE IF EXISTS camera_stage_projects')
  db.exec('DELETE FROM camera_stage_render_tasks')
}

export const cameraStageProjectsNeedBackup = legacyTablesHaveRows('camera_stage_projects', 'camera_stage_render_tasks')

/**
 * 口播（3.3）：删 `audio_edit_projects`；处理任务表 `audio_edit_tasks` 原来按旧工程 ID 归属并级联删除，
 * 旧回执已无处可指，整表重建为按口播文档 ID（`document_id`）归属、不再引用工程表。
 * 原来这两张表由 `initializeLegacyProjectTables` 每次启动建表，从本项起只由账本管理。
 */
export function retireAudioEditProjectsV1(db: Database.Database): void {
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

export const audioEditProjectsNeedBackup = legacyTablesHaveRows('audio_edit_projects', 'audio_edit_tasks')

/**
 * 画布（3.4）：删 `storyboard_projects` 与更早的 `canvas_projects`（`CanvasProjectService` 的旧表，早已不写）。
 * 画布改存 `.henji-canvas` 文档；旧工程内容不迁移（重要记录 008），有数据时账本先整库备份。
 * 原来这两张表由 `initializeLegacyProjectTables` 每次启动建表，本项之后不再有任何账本之外的建表。
 */
export function retireCanvasProjectsV1(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_storyboard_projects_updated_at;
    DROP TABLE IF EXISTS storyboard_projects;
    DROP INDEX IF EXISTS idx_canvas_projects_updated_at;
    DROP TABLE IF EXISTS canvas_projects;
  `)
}

export const canvasProjectsNeedBackup = legacyTablesHaveRows('storyboard_projects', 'canvas_projects')
