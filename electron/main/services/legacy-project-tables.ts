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
