import { DEFAULT_MCP_PREFERENCES, mcpPreferencesSchema, type McpPreferences } from '../../../../src/core/application-control/localHostContracts'
import { getDb } from '../db'

const KEY = 'mcp.preferences'

export function readMcpPreferences(): McpPreferences {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined
  return row ? mcpPreferencesSchema.parse(JSON.parse(row.value)) : structuredClone(DEFAULT_MCP_PREFERENCES)
}

export function writeMcpPreferences(value: McpPreferences): void {
  const preferences = mcpPreferencesSchema.parse(value)
  getDb().prepare(`INSERT INTO settings(key, value, type, updated_at) VALUES (?, ?, 'json', CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).run(KEY, JSON.stringify(preferences))
}
