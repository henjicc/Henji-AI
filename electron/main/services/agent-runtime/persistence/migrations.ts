import type Database from 'better-sqlite3'

interface SchemaMigration {
  version: number
  name: string
  up: (database: Database.Database) => void
}

const migrations: SchemaMigration[] = [
  {
    version: 1,
    name: 'agent-runtime-persistence',
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS agent_threads (
          thread_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_run_id TEXT
        );

        CREATE TABLE IF NOT EXISTS agent_runs (
          run_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES agent_threads(thread_id) ON DELETE CASCADE,
          goal TEXT NOT NULL,
          request_json TEXT NOT NULL,
          state_json TEXT NOT NULL,
          status TEXT NOT NULL,
          checkpoint_version TEXT NOT NULL,
          checkpoint_json TEXT NOT NULL,
          recovery_status TEXT NOT NULL DEFAULT 'none'
            CHECK (recovery_status IN ('none', 'recovery_required', 'retried')),
          parent_run_id TEXT REFERENCES agent_runs(run_id),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_runs_thread_updated
          ON agent_runs(thread_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated
          ON agent_runs(status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS agent_events (
          run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          event_id TEXT NOT NULL UNIQUE,
          event_json TEXT NOT NULL,
          occurred_at INTEGER NOT NULL,
          PRIMARY KEY (run_id, sequence)
        );

        CREATE TABLE IF NOT EXISTS agent_artifacts (
          artifact_ref TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
          source TEXT NOT NULL,
          data_classes_json TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          original_bytes INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_artifacts_run
          ON agent_artifacts(run_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS agent_messages (
          message_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES agent_threads(thread_id) ON DELETE CASCADE,
          run_id TEXT REFERENCES agent_runs(run_id) ON DELETE SET NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system_event')),
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_messages_thread_created
          ON agent_messages(thread_id, created_at ASC);

        CREATE TABLE IF NOT EXISTS agent_permission_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
          tool_call_id TEXT,
          action TEXT NOT NULL,
          outcome TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_permission_audit_run
          ON agent_permission_audit(run_id, created_at ASC);
      `)
    },
  },
  {
    version: 2,
    name: 'agent-memory',
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS agent_memory_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 0,
          default_ttl_days INTEGER NOT NULL DEFAULT 90,
          updated_at INTEGER NOT NULL
        );

        INSERT OR IGNORE INTO agent_memory_settings(id, enabled, default_ttl_days, updated_at)
        VALUES (1, 0, 90, 0);

        CREATE TABLE IF NOT EXISTS agent_memories (
          memory_id TEXT PRIMARY KEY,
          scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'workspace', 'project')),
          scope_id TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('preference', 'fact', 'workflow')),
          content TEXT NOT NULL,
          source_run_id TEXT REFERENCES agent_runs(run_id) ON DELETE SET NULL,
          source_label TEXT NOT NULL,
          sensitivity TEXT NOT NULL CHECK (sensitivity IN ('C0', 'C1')),
          status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'deleted')),
          conflict_key TEXT,
          expires_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_memories_scope_status
          ON agent_memories(scope_type, scope_id, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_memories_expiry
          ON agent_memories(status, expires_at);

        CREATE TABLE IF NOT EXISTS agent_memory_conflicts (
          conflict_id TEXT PRIMARY KEY,
          existing_memory_id TEXT NOT NULL REFERENCES agent_memories(memory_id) ON DELETE CASCADE,
          replacement_memory_id TEXT NOT NULL REFERENCES agent_memories(memory_id) ON DELETE CASCADE,
          resolution TEXT NOT NULL CHECK (resolution IN ('replace', 'keep_existing', 'keep_both')),
          created_at INTEGER NOT NULL
        );
      `)
    },
  },
  {
    version: 3,
    name: 'agent-memory-candidates',
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS agent_memory_candidates (
          candidate_id TEXT PRIMARY KEY,
          scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'workspace', 'project')),
          scope_id TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('preference', 'fact', 'workflow')),
          content TEXT NOT NULL,
          source_run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
          source_label TEXT NOT NULL,
          conflict_key TEXT,
          status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
          ttl_days INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_memory_candidates_status
          ON agent_memory_candidates(status, expires_at);
      `)
    },
  },
  {
    version: 4,
    name: 'agent-model-traces',
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS agent_model_traces (
          trace_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
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

        CREATE INDEX IF NOT EXISTS idx_agent_model_traces_run_started
          ON agent_model_traces(run_id, started_at ASC);
        CREATE INDEX IF NOT EXISTS idx_agent_model_traces_started
          ON agent_model_traces(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_model_traces_model
          ON agent_model_traces(provider_id, model_id, started_at DESC);
      `)
    },
  },
  {
    version: 5,
    name: 'agent-permission-audit-query-index',
    up: (database) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_agent_permission_audit_tool_call
          ON agent_permission_audit(run_id, tool_call_id, created_at ASC);
      `)
    },
  },
  {
    version: 6,
    name: 'agent-session-entries',
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS agent_session_entries (
          entry_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES agent_threads(thread_id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          run_id TEXT REFERENCES agent_runs(run_id) ON DELETE SET NULL,
          turn INTEGER,
          kind TEXT NOT NULL CHECK (kind IN (
            'user_message', 'assistant_message', 'compaction',
            'queued_message', 'external_wait', 'run_reference'
          )),
          schema_version TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'superseded', 'tombstoned')),
          parent_entry_id TEXT REFERENCES agent_session_entries(entry_id),
          idempotency_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(thread_id, sequence),
          UNIQUE(thread_id, idempotency_key)
        );

        CREATE INDEX IF NOT EXISTS idx_agent_session_entries_thread_sequence
          ON agent_session_entries(thread_id, sequence ASC);
        CREATE INDEX IF NOT EXISTS idx_agent_session_entries_run
          ON agent_session_entries(run_id, sequence ASC);
      `)

      const threads = database.prepare(`
        SELECT DISTINCT thread_id FROM agent_messages ORDER BY thread_id ASC
      `).all() as Array<{ thread_id: string }>
      const loadMessages = database.prepare(`
        SELECT message_id, thread_id, run_id, role, content, created_at
        FROM agent_messages
        WHERE thread_id = ?
        ORDER BY created_at ASC, message_id ASC
      `)
      const insertEntry = database.prepare(`
        INSERT OR IGNORE INTO agent_session_entries(
          entry_id, thread_id, sequence, run_id, turn, kind, schema_version,
          payload_json, status, parent_entry_id, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, NULL, ?, 'agent-session-entry/v1', ?, 'active', NULL, ?, ?)
      `)
      for (const thread of threads) {
        const messages = loadMessages.all(thread.thread_id) as Array<{
          message_id: string
          thread_id: string
          run_id: string | null
          role: 'user' | 'assistant' | 'system_event'
          content: string
          created_at: number
        }>
        let sequence = 0
        for (const message of messages) {
          if (message.role === 'system_event') continue
          sequence += 1
          insertEntry.run(
            `legacy:${message.message_id}`,
            message.thread_id,
            sequence,
            message.run_id,
            message.role === 'user' ? 'user_message' : 'assistant_message',
            JSON.stringify({ content: message.content, legacy: true }),
            `legacy:${message.message_id}`,
            message.created_at
          )
        }
      }
    },
  },
]

export function runAgentSchemaMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)
  const applied = new Set(
    database.prepare('SELECT version FROM app_schema_migrations').all()
      .map((row) => Number((row as { version: number }).version))
  )
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue
    database.transaction(() => {
      migration.up(database)
      database.prepare(`
        INSERT INTO app_schema_migrations(version, name, applied_at)
        VALUES (?, ?, ?)
      `).run(migration.version, migration.name, Date.now())
    })()
  }
}

export const AGENT_SCHEMA_VERSION = migrations[migrations.length - 1]?.version ?? 0
