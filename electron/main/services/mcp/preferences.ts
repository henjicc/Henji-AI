import { DEFAULT_MCP_PREFERENCES, mcpPreferencesSchema, type McpPreferences } from '../../../../src/core/application-control/localHostContracts'
import { getSettingsStore } from '../settings/store'

const KEY = 'mcp.preferences'

export function readMcpPreferences(): McpPreferences {
  const value = getSettingsStore().get(KEY)
  return value ? mcpPreferencesSchema.parse(JSON.parse(value)) : structuredClone(DEFAULT_MCP_PREFERENCES)
}

export function writeMcpPreferences(value: McpPreferences): void {
  const preferences = mcpPreferencesSchema.parse(value)
  getSettingsStore().set(KEY, JSON.stringify(preferences), 'json')
}
