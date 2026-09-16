import type Database from 'better-sqlite3'

export function initializeAssistantMemorySchema(database: Database.Database): void {
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
          source_run_id TEXT,
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
      

        CREATE TABLE IF NOT EXISTS agent_memory_candidates (
          candidate_id TEXT PRIMARY KEY,
          scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'workspace', 'project')),
          scope_id TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('preference', 'fact', 'workflow')),
          content TEXT NOT NULL,
          source_run_id TEXT NOT NULL,
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
}
