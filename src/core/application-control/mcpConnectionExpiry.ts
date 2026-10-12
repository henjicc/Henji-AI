export const MCP_CONNECTION_DAY_MS = 24 * 60 * 60 * 1000
export const MCP_CONNECTION_LIFETIME_MS = 30 * MCP_CONNECTION_DAY_MS
export type McpConnectionExpiryState = 'active' | 'expiring' | 'expired'
export type McpConnectionReminderState = Exclude<McpConnectionExpiryState, 'active'>

export function mcpConnectionExpiryState(expiresAt: number, now = Date.now()): McpConnectionExpiryState {
  if (expiresAt <= now) return 'expired'
  return expiresAt - now <= 3 * MCP_CONNECTION_DAY_MS ? 'expiring' : 'active'
}

/** 本地日历日期，与界面及认证错误一致，不用 UTC 截断日期。 */
export function mcpConnectionLocalDate(expiresAt: number): string {
  const date = new Date(expiresAt)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
