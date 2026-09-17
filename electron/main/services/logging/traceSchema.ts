import type Database from 'better-sqlite3'

export function initializeModelTraceSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS model_trace_contexts (run_id TEXT PRIMARY KEY, thread_id TEXT, goal TEXT, status TEXT);

        CREATE TABLE IF NOT EXISTS application_model_traces (
          trace_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          request_id TEXT NOT NULL,
          step_id TEXT NOT NULL,
          step_kind TEXT NOT NULL CHECK (step_kind IN ('router', 'primary', 'summarizer', 'fallback', 'other')),
          turn INTEGER,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          elapsed_ms INTEGER,
          finish_reason TEXT,
          usage_json TEXT NOT NULL,
          capture_mode TEXT NOT NULL CHECK (capture_mode IN ('summary', 'detailed')),
          detail_json TEXT,
          detail_bytes INTEGER NOT NULL DEFAULT 0,
          original_detail_bytes INTEGER NOT NULL DEFAULT 0,
          detail_truncated INTEGER NOT NULL DEFAULT 0,
          error_json TEXT,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_application_model_traces_run_started
          ON application_model_traces(run_id, started_at ASC);
        CREATE INDEX IF NOT EXISTS idx_application_model_traces_started
          ON application_model_traces(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_application_model_traces_model
          ON application_model_traces(provider_id, model_id, started_at DESC);
      
  `)
}
