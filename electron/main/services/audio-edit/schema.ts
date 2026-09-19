import type Database from 'better-sqlite3'

export function initializeAudioEditSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audio_edit_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      document_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audio_edit_projects_updated_at
      ON audio_edit_projects(updated_at DESC);

    CREATE TABLE IF NOT EXISTS audio_edit_tasks (
      request_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES audio_edit_projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      provider_task_id TEXT,
      input_digest TEXT NOT NULL,
      result_json TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audio_edit_tasks_project
      ON audio_edit_tasks(project_id, updated_at DESC);
  `)
}
