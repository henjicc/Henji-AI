import type { McpPlatform } from '../../src/core/application-control/localHostContracts'

export function createMcpApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>): McpPlatform {
  return {
    status: () => invoke('mcp:status'), configure: (input) => invoke('mcp:configure', input),
    authorize: (input) => invoke('mcp:authorize', input), revoke: (input) => invoke('mcp:revoke', input),
    connectionConfig: (input) => invoke('mcp:config', input),
  }
}
