import { getPlatform } from '@/platform'
import type { McpPlatform } from '@/core/application-control/localHostContracts'

export function getMcpConnectionService(): McpPlatform { return getPlatform().mcp }
