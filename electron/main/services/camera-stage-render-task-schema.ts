import type Database from 'better-sqlite3'

/**
 * 镜头参考渲染任务回执（迁移账本第 12 项），唯一读写入口是 camera-stage-render-task-storage.ts。
 * 2.3 之前在第一次读取时才建表，已存在的表与数据原样保留。
 */
export function createCameraStageRenderTaskTableV1(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS camera_stage_render_tasks (request_id TEXT PRIMARY KEY, record_json TEXT NOT NULL)')
}
