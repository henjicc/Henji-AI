import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { localHostRegistrationSchema, localHostReplySchema, type McpStatus } from '../../../src/core/application-control/localHostContracts'
import { getMainWindow } from '../window'
import { getKey, setKey } from '../services/keystore'
import { createMainLogger } from '../services/logging'
import { McpConnections } from '../services/mcp/connections'
import { ApplicationHostBridge } from '../services/mcp/applicationHostBridge'
import { LocalMcpServer } from '../services/mcp/server'
import { McpOperationStore } from '../services/mcp/operationStore'
import { McpOperationCoordinator } from '../services/mcp/operationCoordinator'
import { getDb } from '../services/db'
import { parseVoid, registerIpcHandler } from './registry'

const logger = createMainLogger('main.mcp')
const connections = new McpConnections({ read: () => getKey('mcp', 'connections'), write: (value) => setKey('mcp', 'connections', value) })
let host: ApplicationHostBridge
let server: LocalMcpServer
let configuredPort = 43821
let changing = false
const watched = new WeakSet<Electron.WebContents>()

function trusted(event: IpcMainInvokeEvent): void {
  const window = getMainWindow()
  if (!window || window.isDestroyed() || BrowserWindow.fromWebContents(event.sender) !== window || event.senderFrame !== event.sender.mainFrame) throw new Error('不可信的连接管理请求。')
  const url = event.senderFrame.url
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl ? new URL(url).origin !== new URL(developmentUrl).origin : !url.startsWith('file://')) throw new Error('不可信的连接管理来源。')
}
function status(): McpStatus { return { enabled: server.listening, ready: host.ready, port: configuredPort, connections: connections.list() } }

export function registerMcpIpc(): void {
  const operations = new McpOperationCoordinator(new McpOperationStore(getDb()))
  host = new ApplicationHostBridge((id) => connections.assertActive(id), operations)
  server = new LocalMcpServer(connections, host, (error) => logger.error('外部连接请求失败', { event: 'mcp.request.failed', error }), operations)
  registerIpcHandler('mcp:status', parseVoid, status, trusted)
  registerIpcHandler('mcp:configure', (value) => z.object({ enabled: z.boolean(), port: z.number().int().min(1024).max(65535) }).strict().parse(value), async (input) => {
    if (changing) throw new Error('连接设置正在保存，请稍后重试。')
    changing = true
    logger.info('开始设置外部连接', { event: 'mcp.configure.start' })
    try {
      if (!input.enabled) await server.stop()
      else if (!server.listening) await server.start(input.port)
      else if (input.port !== configuredPort) throw new Error('请先关闭外部连接，再更换端口。')
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
  registerIpcHandler('mcp:authorize', (value) => z.object({ name: z.string().trim().min(1).max(80), allowWrites: z.boolean().optional(), allowDestructive: z.boolean().optional() }).strict().parse(value), (input) => {
    const connection = connections.create(input.name, input)
    logger.info('已授权只读连接', { event: 'mcp.authorize.completed', context: { callerId: connection.id } })
    return connection
  }, trusted)
  const identity = (value: unknown): { id: string } => z.object({ id: z.string().uuid() }).strict().parse(value)
  registerIpcHandler('mcp:revoke', identity, async ({ id }) => {
    connections.revoke(id)
    await server.revoke(id)
    logger.info('已撤销外部连接', { event: 'mcp.revoke.completed', context: { callerId: id } })
  }, trusted)
  registerIpcHandler('mcp:config', identity, ({ id }) => JSON.stringify({ mcpServers: { henji: { type: 'http', url: `http://127.0.0.1:${configuredPort}/mcp`, headers: { Authorization: `Bearer ${connections.token(id)}` } } } }, null, 2), trusted)
  registerIpcHandler('mcp:host:register', (value) => localHostRegistrationSchema.parse(value), (input, event) => {
    if (!watched.has(event.sender)) {
      watched.add(event.sender)
      event.sender.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) host.disconnect() })
      event.sender.once('destroyed', () => host.disconnect())
    }
    host.register(input, { send: (channel, payload) => { if (!event.sender.isDestroyed()) event.sender.send(channel, payload) } })
  }, trusted)
  registerIpcHandler('mcp:host:complete', (value) => localHostReplySchema.parse(value), (input) => host.complete(input), trusted)
}
export async function disposeMcp(): Promise<void> { await server?.stop() }
