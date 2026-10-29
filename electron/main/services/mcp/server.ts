import { toMcpResult } from './resultProjection'
import { APPLICATION_RESOURCE_TEMPLATES, listApplicationResources, readApplicationResource } from './resources'
import { ApplicationResourceSubscriptions } from './resourceSubscriptions'
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http'
import { createMcpHandler, Server, type McpHttpHandler, type AuthInfo } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { EXTERNAL_SERVER_INFO } from '../../../../src/core/application-control/localHostContracts'
import type { McpConnections } from './connections'
import type { McpRelayConnector, RelayLink, RelayLinkState } from './relayLink'
import type { ApplicationHostBridge } from '../application-runtime/applicationHostBridge'
import type { ApplicationOperationCoordinator } from '../application-runtime/operationCoordinator'
import { ApplicationToolDispatcher } from '../application-runtime/applicationToolDispatcher'
import { buildApplicationToolCatalog } from '../application-runtime/toolCatalog'
import { EXTERNAL_CONTRACT_VERSION } from '../../../../src/core/application-control/localHostContracts'
import type { MemoryEntryStore } from '../assistant/entry-store'
import { MEMORY_RULES } from '../../../../src/core/assistant/memoryEntries'
import { PROJECT_PROGRESS_RULES } from '../../../../src/core/documents/projectProgress'

/** 无协议会话；授权、任务与持久操作均由应用运行时持有。 */
export class LocalMcpServer {
  private http: HttpServer | undefined
  private handler: McpHttpHandler | undefined
  /** 在途的 HTTP 响应：撤销授权时逐个切断。`listen` 是长期挂着的订阅流，不占普通请求的并发名额。 */
  private active = new Map<ServerResponse, { callerId: string; listen: boolean }>()
  /** 对外地址的端口：经接线员转发时是接线员的端口，直接监听时是本服务的端口。 */
  private port = 0
  private relayLink?: RelayLink
  private detach?: () => void
  private detachMemory?: () => void
  private authorizationTimer?: ReturnType<typeof setInterval>
  private subscriptions?: ApplicationResourceSubscriptions
  constructor(private readonly connections: McpConnections, private readonly host: ApplicationHostBridge,
    private readonly onError: (error: unknown) => void = () => {}, private readonly operations?: ApplicationOperationCoordinator,
    private readonly onRequest: (info: { callerId: string }) => void = () => {},
    private readonly onRejected: (info: { reason: 'invalid_token' }) => void = () => {},
    private readonly memory?: Pick<MemoryEntryStore, 'onMemoryChange' | 'read'>,
    /** 有接线员时由它占住对外端口，痕迹重启期间外部请求不断；监听位置与重试由接线决定。 */
    private readonly relay?: McpRelayConnector) {}
  get listening(): boolean { return this.relayLink !== undefined || this.http?.listening === true }
  /** 对外是否真的在服务；没有接线员时以直接监听为准。 */
  get availability(): RelayLinkState | undefined { return this.relayLink?.state() ?? (this.http?.listening ? 'direct' : undefined) }
  get listeningPort(): number { return this.port }
  async start(port: number): Promise<void> {
    if (this.http) throw new Error('服务已经启用，请先关闭再更换端口。')
    const subscriptions = new ApplicationResourceSubscriptions(id => this.connections.assertActive(id),
      (id, uri, signal) => readApplicationResource(new ApplicationToolDispatcher(this.connections, this.host, this.operations), id, uri, signal))
    this.subscriptions = subscriptions
    let domainRevisions: Record<string, number> = {}
    const contextChanged = () => {
      const context = this.host.getContext()
      subscriptions.contextChanged({ ...context?.scopeRevisions, ...domainRevisions }, context?.resourceRevisions)
    }
    contextChanged()
    this.detachMemory = this.memory?.onMemoryChange(change => {
      domainRevisions = { ...domainRevisions, ...change.revisions }
      contextChanged()
      this.handler?.notify.toolsChanged()
      this.handler?.notify.resourcesChanged()
    })
    const handler = createMcpHandler(context => {
      const callerId = context.authInfo?.clientId
      if (!callerId) throw new Error('调用者未获授权。')
      this.connections.assertActive(callerId)
      const server = new Server({ ...EXTERNAL_SERVER_INFO }, { instructions: `${MEMORY_RULES}\n${PROJECT_PROGRESS_RULES}\n当前全局记忆快照：${JSON.stringify(this.memory?.read().entries ?? [])}`, capabilities: { tools: { listChanged: true }, resources: { listChanged: true, subscribe: true } } })
      const dispatcher = new ApplicationToolDispatcher(this.connections, this.host, this.operations, this.port)
      server.setRequestHandler('tools/list', async () => ({ tools: dispatcher.catalog(callerId).tools }))
      server.setRequestHandler('resources/templates/list', async () => ({ resourceTemplates: APPLICATION_RESOURCE_TEMPLATES }))
      server.setRequestHandler('resources/list', async (request, ctx) => {
        if (!this.host.ready) throw new Error('CAPABILITY_NOT_READY:应用正在连接，请稍后重新读取资源目录。')
        return listApplicationResources(dispatcher, callerId, this.host.domains(), request.params?.cursor, ctx.mcpReq.signal)
      })
      server.setRequestHandler('resources/read', async (request, ctx) => {
        const result = await readApplicationResource(dispatcher, callerId, request.params.uri, ctx.mcpReq.signal)
        return result
      })
      server.setRequestHandler('tools/call', async (request, ctx) => {
        const result = await dispatcher.call(callerId, request.params.name, request.params.arguments, ctx.mcpReq.signal)
        return toMcpResult(result)
      })
      return server
    }, { legacy: 'reject', onerror: this.onError, maxSubscriptions: Infinity, bus: subscriptions })
    this.handler = handler
    const directorySignature = () => JSON.stringify({ version: EXTERNAL_CONTRACT_VERSION,
      tools: buildApplicationToolCatalog({ tools: this.host.tools(), includeSkillTool: true }).tools })
    let signature = directorySignature()
    this.detach = this.host.onChange(kind => {
      if (kind === 'catalog') {
        const current = directorySignature()
        if (current !== signature) { signature = current; handler.notify.toolsChanged() }
        handler.notify.resourcesChanged()
        subscriptions.refresh()
      } else {
        contextChanged()
      }
    })
    this.authorizationTimer = setInterval(() => {
      for (const [response, { callerId }] of this.active) {
        try { this.connections.assertActive(callerId) } catch { response.destroy() }
      }
    }, 1000)
    this.authorizationTimer.unref()
    const nodeHandler = toNodeHandler(handler, { onerror: this.onError })
    const http = createServer((request, response) => {
      void this.handle(request, response, nodeHandler).catch(error => {
        this.onError(error)
        if (!response.headersSent) response.writeHead(500)
        response.end()
      })
    })
    http.requestTimeout = 15_000
    http.headersTimeout = 10_000
    this.http = http
    try {
      if (this.relay) {
        this.port = port
        this.relayLink = await this.relay(port, http)
        return
      }
      // 重启应用时旧实例可能尚未释放端口：EADDRINUSE 短暂退避重试，避免外部连接整轮掉线。
      for (let attempt = 0; ; attempt++) {
        try {
          await new Promise<void>((resolve, reject) => {
            http.once('error', reject)
            http.listen(port, '127.0.0.1', () => { http.removeListener('error', reject); resolve() })
          })
          break
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt >= 7) throw error
          await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt))
        }
      }
      const address = http.address()
      this.port = address && typeof address !== 'string' ? address.port : port
    } catch (error) { await this.stop(); throw error }
  }

  /** `releasePort` 为真时连同接线员一起关闭（用户关掉外部连接）；应用退出时保留接线员替外部客户端等下一次启动。 */
  async stop(options: { releasePort?: boolean } = {}): Promise<void> {
    const http = this.http
    this.http = undefined
    const relayLink = this.relayLink
    this.relayLink = undefined
    await relayLink?.stop({ release: options.releasePort })
    this.detach?.()
    this.detach = undefined
    this.detachMemory?.()
    this.detachMemory = undefined
    clearInterval(this.authorizationTimer)
    // HTTP 关闭只结束这些请求的等待，不能撤销持久业务操作或内置 Pi。
    await this.handler?.close()
    this.handler = undefined
    this.subscriptions = undefined
    if (http) await new Promise<void>(resolve => { http.close(() => resolve()); http.closeAllConnections() })
    this.active.clear()
  }

  async revoke(callerId: string): Promise<void> {
    this.host.revoke(callerId)
    await new Promise<void>(resolve => setImmediate(resolve))
    for (const [response, owner] of this.active) if (owner.callerId === callerId) response.destroy()
  }

  private reject(response: ServerResponse, status: number): void { response.writeHead(status, { 'Cache-Control': 'no-store' }); response.end() }
  private async handle(request: IncomingMessage & { auth?: AuthInfo }, response: ServerResponse, dispatch: ReturnType<typeof toNodeHandler>): Promise<void> {
    response.setHeader('Cache-Control', 'no-store')
    if (!this.listening || request.url !== '/mcp') return this.reject(response, 404)
    if (request.headers.host !== `127.0.0.1:${this.port}` || request.headers.origin !== undefined) return this.reject(response, 403)
    const authorization = request.headers.authorization
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
    const authentication = this.connections.authenticate(token)
    if (authentication.status !== 'valid') {
      this.onRejected({ reason: 'invalid_token' })
      response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'WWW-Authenticate': 'Bearer error="invalid_token"' })
      response.end(JSON.stringify({ error: 'invalid_token', message: '令牌无效或连接已撤销，请在痕迹AI 设置 → 智能助手 → 外部智能体连接 中重新授权。' }))
      return
    }
    const callerId = authentication.connectionId
    if (request.method !== 'POST') return this.reject(response, 405)
    if (request.headers['mcp-session-id'] !== undefined) return this.reject(response, 400)
    if (!request.headers['content-type']?.startsWith('application/json')) return this.reject(response, 415)
    const entry = { callerId, listen: false }
    this.active.set(response, entry)
    response.once('close', () => this.active.delete(response))
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
        chunks.push(buffer)
      }
      let body: unknown
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return this.reject(response, 400) }
      if (Array.isArray(body)) return this.reject(response, 400)
      const listen = (body as { method?: unknown } | null)?.method === 'subscriptions/listen'
      this.connections.assertActive(callerId)
      request.auth = { token, clientId: callerId, scopes: [] }
      this.onRequest({ callerId })
      const controller = new AbortController()
      response.once('close', () => controller.abort())
      try {
        await this.subscriptions!.run(callerId, body, controller.signal, () => { entry.listen = listen; return dispatch(request, response, body) })
      } catch (error) {
        if (response.headersSent || response.destroyed) throw error
        const id = body && typeof body === 'object' && 'id' in body ? body.id : null
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32602, message: error instanceof Error ? error.message : '资源订阅未获授权。' } }))
      }
    } finally { if (response.writableEnded || response.destroyed) this.active.delete(response) }
  }
}
