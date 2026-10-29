import type Database from 'better-sqlite3'

import { createAssistantMemoryTablesV1 } from './assistant/storageSchema'

/*
 * 冻结未接入迁移账本的数据库结构，用于证明迁移保留原始数据并补齐结果与位置字段。
 * 夹具必须独立于当前建表逻辑，否则同源结构变更会掩盖迁移缺陷。
 */
export const MIGRATION_FIXTURE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, type TEXT NOT NULL, prompt TEXT,
    params TEXT NOT NULL, file_path TEXT, task_id TEXT, status TEXT NOT NULL, error_message TEXT, cost REAL,
    duration INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS presets (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, model_id TEXT, params TEXT NOT NULL,
    is_favorite INTEGER DEFAULT 0, use_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, type TEXT NOT NULL, description TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS custom_models (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, provider_id TEXT NOT NULL, base_model TEXT, config TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS progress_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT, model_id TEXT NOT NULL, provider_id TEXT NOT NULL, media_type TEXT NOT NULL,
    profile_key TEXT NOT NULL, time_bucket TEXT NOT NULL, duration_ms INTEGER NOT NULL, started_at_ms INTEGER NOT NULL,
    finished_at_ms INTEGER NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS pending_task_results (
    server_task_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, completed_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'code')),
    display_name TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL CHECK (source IN ('generated', 'canvas', 'camera-stage', 'imported', 'external', 'video-edit')),
    mime_type TEXT, size_bytes INTEGER, width INTEGER, height INTEGER, duration_seconds REAL, thumbnail_path TEXT,
    inspection_status TEXT NOT NULL DEFAULT 'pending' CHECK (inspection_status IN ('pending', 'ready', 'missing', 'failed')),
    inspection_error TEXT, file_modified_at INTEGER, content_identity TEXT, last_used_at INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS asset_libraries (
    id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS asset_library_items (
    library_id TEXT NOT NULL REFERENCES asset_libraries(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    added_at INTEGER NOT NULL, sort_order INTEGER, PRIMARY KEY (library_id, asset_id)
  );
  CREATE TABLE IF NOT EXISTS asset_tags (
    id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS asset_tag_items (
    tag_id TEXT NOT NULL REFERENCES asset_tags(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    PRIMARY KEY (tag_id, asset_id)
  );
  CREATE TABLE IF NOT EXISTS generation_submissions (
    request_id TEXT PRIMARY KEY, input_digest TEXT NOT NULL, response_json TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS camera_stage_render_tasks (request_id TEXT PRIMARY KEY, record_json TEXT NOT NULL);
  -- 3.2 退役的镜头参考工程表（2.3 之前的库里都有）
  CREATE TABLE IF NOT EXISTS camera_stage_projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    object_count INTEGER NOT NULL DEFAULT 0, scene_json TEXT NOT NULL, cover_path TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_camera_stage_projects_updated_at ON camera_stage_projects(updated_at DESC);
  -- 3.4 退役的画布工程表（2.3 之前每次启动由 initializeLegacyProjectTables 建）
  CREATE TABLE IF NOT EXISTS storyboard_projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0, nodes_json TEXT NOT NULL, edges_json TEXT NOT NULL,
    viewport_json TEXT NOT NULL, history_json TEXT NOT NULL, cover_path TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_storyboard_projects_updated_at ON storyboard_projects(updated_at DESC);
  CREATE TABLE IF NOT EXISTS canvas_projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, nodes_json TEXT NOT NULL, edges_json TEXT NOT NULL, viewport_json TEXT NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_canvas_projects_updated_at ON canvas_projects(updated_at DESC);
`

export function createDatabaseMigrationFixture(db: Database.Database): void {
  db.exec(MIGRATION_FIXTURE_SCHEMA_SQL)
  createAssistantMemoryTablesV1(db)
}
