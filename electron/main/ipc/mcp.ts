import { assertTrustedApplicationSender } from './application-control'
import { getApplicationRuntime, registerExternalApplicationAuthority } from '../services/application-runtime/runtime'
import { z } from 'zod'
import { mcpDefaultAccessSchema, DEFAULT_MCP_PREFERENCES, type McpStatus } from '../../../src/core/application-control/localHostContracts'
import { readMcpPreferences, writeMcpPreferences } from '../services/mcp/preferences'
import { getKey, setKey } from '../services/keystore'
import { createMainLogger } from '../services/logging'
import { McpConnections } from '../services/mcp/connections'
import { ApplicationHostBridge } from '../services/application-runtime/applicationHostBridge'
import { LocalMcpServer } from '../services/mcp/server'
import { parseVoid, registerIpcHandler } from './registry'

const logger = createMainLogger('main.mcp')
const connections = new McpConnections({ read: () => getKey('mcp', 'connections'), write: (value) => setKey('mcp', 'connections', value) })
let host: ApplicationHostBridge
let server: LocalMcpServer
let configuredPort = 43821
let preferences = structuredClone(DEFAULT_MCP_PREFERENCES)
let changing = false

const trusted = assertTrustedApplicationSender
function status(): McpStatus { return { enabled: server.listening, ready: host.ready, port: configuredPort, connections: connections.list(), defaultAccess: preferences.defaultAccess } }

export function registerMcpIpc(): void {
  const { host: applicationHost, operations } = getApplicationRuntime()
  host = applicationHost
  registerExternalApplicationAuthority((id) => connections.assertActive(id))
  server = new LocalMcpServer(connections, host, (error) => logger.error('外部连接请求失败', { event: 'mcp.request.failed', error }), operations,
    (info) => logger.info('外部请求已通过授权', { event: 'mcp.request.authorized', context: { callerId: info.callerId } }))
  try { preferences = readMcpPreferences() } catch (error) {
    preferences = { ...DEFAULT_MCP_PREFERENCES, enabled: false, defaultAccess: { allowWrites: false, allowDestructive: false, allowPaid: false } }
    logger.error('读取外部连接设置失败，已保持关闭', { event: 'mcp.preferences.read.failed', error })
  }
  configuredPort = preferences.port
  const startup = (preferences.enabled ? server.start(configuredPort) : Promise.resolve())
    .catch(error => { logger.error('恢复外部连接失败', { event: 'mcp.restore.failed', error }) })
  registerIpcHandler('mcp:status', parseVoid, async () => { await startup; return status() }, trusted)
  registerIpcHandler('mcp:configure', (value) => z.object({ enabled: z.boolean(), port: z.number().int().min(1024).max(65535), defaultAccess: mcpDefaultAccessSchema.optional() }).strict().parse(value), async (input) => {
    if (changing) throw new Error('连接设置正在保存，请稍后重试。')
    changing = true
    logger.info('开始设置外部连接', { event: 'mcp.configure.start' })
    try {
      await startup
      if (!input.enabled) await server.stop()
      else if (!server.listening) await server.start(input.port)
      else if (input.port !== configuredPort) throw new Error('请先关闭外部连接，再更换端口。')
      const next = { enabled: input.enabled, port: input.port, defaultAccess: input.defaultAccess ?? preferences.defaultAccess }
      try { writeMcpPreferences(next) } catch (error) {
        if (!preferences.enabled) await server.stop()
        else if (!server.listening) await server.start(preferences.port)
        throw error
      }
      preferences = next
      configuredPort = input.port
      logger.info('外部连接设置完成', { event: 'mcp.configure.completed', context: { enabled: input.enabled } })
      return status()
    } catch (error) {
      logger.error('外部连接设置失败', { event: 'mcp.configure.failed', error })
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') throw new Error('连接端口已被占用，请更换端口后重试。')
      throw error
    }
    finally { changing = false }
  }, trusted)
  registerIpcHandler('mcp:authorize', (value) => z.object({ name: z.string().trim().min(1).max(80), allowWrites: z.boolean().optional(), allowDestructive: z.boolean().optional(), allowPaid: z.boolean().optional() }).strict().parse(value), (input) => {
    const connection = connections.create(input.name, { ...preferences.defaultAccess, ...input })
    logger.info('已授权外部连接', { event: 'mcp.authorize.completed', context: { callerId: connection.id } })
    return connection
  }, trusted)
  const identity = (value: unknown): { id: string } => z.object({ id: z.string().uuid() }).strict().parse(value)
  registerIpcHandler('mcp:revoke', identity, async ({ id }) => {
    connections.revoke(id)
    await server.revoke(id)
    logger.info('已撤销外部连接', { event: 'mcp.revoke.completed', context: { callerId: id } })
  }, trusted)
  registerIpcHandler('mcp:config', identity, ({ id }) => JSON.stringify({ mcpServers: { henji: { type: 'http', url: `http://127.0.0.1:${configuredPort}/mcp`, headers: { Authorization: `Bearer ${connections.token(id)}` } } } }, null, 2), trusted)
}
export async function disposeMcp(): Promise<void> { await server?.stop() }
