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
import { createRelayConnector, launchRelay } from '../services/mcp/relayLink'
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
function status(): McpStatus {
  const availability = server.availability
  const issue = availability === 'connecting' || availability === 'port_in_use' ? availability : undefined
  return { enabled: server.listening, ...(issue ? { issue } : {}), ready: host.ready, port: configuredPort, connections: connections.list() }
}

/**
 * 接线员登记凭据：用 safeStorage 保存；开发版与正式版共用同一资料目录，也就共用同一个接线员。
 * 两个实例同时首次生成时以存储里最终留下的为准，接线每一轮都重新读取，对不上的一方下一轮自然对上。
 */
function relaySecret(): string {
  const saved = getKey('mcp-relay', 'secret')
  if (saved) return saved
  setKey('mcp-relay', 'secret', randomBytes(32).toString('hex'))
  const stored = getKey('mcp-relay', 'secret')
  if (!stored) throw new Error('接线员凭据保存失败')
  return stored
}

/**
 * `resident` 只给正常运行的应用：由它拉起和替换常驻接线员。助手命令行是一次性进程，
 * 自动化的隔离资料目录有自己的凭据，二者都只登记到已有的接线员或在端口空着时直接监听，不在用户端口上留下常驻进程。
 */
export function registerMcpIpc(options: { resident?: boolean } = {}): void {
  const { host: applicationHost, operations } = getApplicationRuntime()
  host = applicationHost
  registerExternalApplicationAuthority((id) => connections.assertActive(id), (id) => connections.list().find(item => item.id === id)?.name)
  const resident = options.resident === true && !process.env['HENJI_ISOLATED_APP_DATA']
  const relay = createRelayConnector({ script: path.join(__dirname, 'mcp-relay.cjs'), secret: relaySecret, logger, relayLogger: createMainLogger('main.mcp_relay'), launch: resident ? launchRelay : undefined })
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
/** 安装更新前连同接线员一起关闭：安装程序会结束安装目录里所有正在运行的进程，接线员也在其中。 */
export async function releaseMcpForUpdate(): Promise<void> { await server?.stop({ releasePort: true }) }
