import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { assertTrustedApplicationSender } from './application-control'
import { getApplicationRuntime, registerExternalApplicationAuthority } from '../services/application-runtime/runtime'
import { z } from 'zod'
import { DEFAULT_MCP_PREFERENCES, type McpStatus } from '../../../src/core/application-control/localHostContracts'
import { readMcpPreferences, writeMcpPreferences } from '../services/mcp/preferences'
import { getKey, setKey } from '../services/keystore'
import { createMainLogger } from '../services/logging'
import { McpConnections } from '../services/mcp/connections'
import { ApplicationHostBridge } from '../services/application-runtime/applicationHostBridge'
import { LocalMcpServer } from '../services/mcp/server'
import { createRelayConnector } from '../services/mcp/relayLink'
import { getAgentMemoryStore } from '../services/assistant/memory'
import { parseVoid, registerIpcHandler } from './registry'

const logger = createMainLogger('main.mcp')
const connections = new McpConnections({ read: () => getKey('mcp', 'connections'), write: (value) => setKey('mcp', 'connections', value) })
let host: ApplicationHostBridge
let server: LocalMcpServer
let configuredPort = 43821
let preferences = structuredClone(DEFAULT_MCP_PREFERENCES)
let changing = false

const trusted = assertTrustedApplicationSender
function status(): McpStatus { return { enabled: server.listening, ready: host.ready, port: configuredPort, connections: connections.list() } }

/** 接线员登记凭据：与连接令牌一样用 safeStorage 保存；开发版与正式版共用同一资料目录，也就共用同一个接线员。 */
function relaySecret(): string {
  const saved = getKey('mcp', 'relaySecret')
  if (saved) return saved
  const created = randomBytes(32).toString('hex')
  setKey('mcp', 'relaySecret', created)
  return created
}

/**
 * `relay` 只给正常运行的应用：助手命令行是一次性进程，不该留下常驻的接线员。
 * 自动化的隔离资料目录有自己的凭据，接不上用户真实资料目录的接线员，也不能在用户的端口上留下自己的接线员，所以照旧直接监听。
 */
export function registerMcpIpc(options: { relay?: boolean } = {}): void {
  const { host: applicationHost, operations } = getApplicationRuntime()
  host = applicationHost
  registerExternalApplicationAuthority((id) => connections.assertActive(id), (id) => connections.list().find(item => item.id === id)?.name)
  const relay = options.relay && !process.env['HENJI_ISOLATED_APP_DATA']
    ? createRelayConnector({ script: path.join(__dirname, 'mcp-relay.cjs'), secret: relaySecret, logger, relayLogger: createMainLogger('main.mcp_relay') })
    : undefined
  server = new LocalMcpServer(connections, host, (error) => logger.error('外部连接请求失败', { event: 'mcp.request.failed', error }), operations,
    (info) => logger.info('外部请求已通过授权', { event: 'mcp.request.authorized', context: { callerId: info.callerId } }),
    (info) => logger.warn('外部连接认证失败', { event: 'mcp.request.rejected', context: info }), getAgentMemoryStore(), relay)
  try { preferences = readMcpPreferences() } catch (error) {
    preferences = { ...DEFAULT_MCP_PREFERENCES, enabled: false }
    logger.error('读取外部连接设置失败，已保持关闭', { event: 'mcp.preferences.read.failed', error })
  }
  configuredPort = preferences.port
  const startup = (preferences.enabled ? server.start(configuredPort) : Promise.resolve())
    .catch(error => { logger.error('恢复外部连接失败', { event: 'mcp.restore.failed', error }) })
  registerIpcHandler('mcp:status', parseVoid, async () => { await startup; return status() }, trusted)
  registerIpcHandler('mcp:configure', (value) => z.object({ enabled: z.boolean(), port: z.number().int().min(1024).max(65535) }).strict().parse(value), async (input) => {
    if (changing) throw new Error('连接设置正在保存，请稍后重试。')
    changing = true
    logger.info('开始设置外部连接', { event: 'mcp.configure.start' })
    try {
      await startup
      if (!input.enabled) await server.stop({ releasePort: true })
      else if (!server.listening) await server.start(input.port)
      else if (input.port !== configuredPort) throw new Error('请先关闭外部连接，再更换端口。')
      const next = { enabled: input.enabled, port: input.port }
      try { writeMcpPreferences(next) } catch (error) {
        if (!preferences.enabled) await server.stop({ releasePort: true })
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
  registerIpcHandler('mcp:authorize', (value) => z.object({ name: z.string().trim().min(1).max(80) }).strict().parse(value), (input) => {
    const connection = connections.create(input.name)
    logger.info('已授权外部连接', { event: 'mcp.authorize.completed', context: { callerId: connection.id } })
    return connection
  }, trusted)
  const identity = (value: unknown): { id: string } => z.object({ id: z.string().uuid() }).strict().parse(value)
  registerIpcHandler('mcp:revoke', identity, async ({ id }) => {
    connections.revoke(id)
    await server.revoke(id)
    logger.info('已撤销外部连接', { event: 'mcp.revoke.completed', context: { callerId: id } })
  }, trusted)
  registerIpcHandler('mcp:config', identity, ({ id }) => {
    const url = `http://127.0.0.1:${configuredPort}/mcp`
    const config = JSON.stringify({ mcpServers: { henji: { type: 'http', url, headers: { Authorization: `Bearer ${connections.token(id)}` } } } }, null, 2)
    // 令牌只交给用户配置客户端，不包装成模型提示词。
    return config
  }, trusted)
}
export async function disposeMcp(): Promise<void> { await server?.stop() }
