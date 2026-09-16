import { toMcpResult } from './resultProjection'
import { APPLICATION_RESOURCE_TEMPLATES, readApplicationResource } from './resources'
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http'
import { createMcpHandler, Server, type McpHttpHandler, type AuthInfo } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { EXTERNAL_LIMITS, EXTERNAL_SERVER_INFO } from '../../../../src/core/application-control/localHostContracts'
import type { McpConnections } from './connections'
import type { ApplicationHostBridge } from '../application-runtime/applicationHostBridge'
import type { ApplicationOperationCoordinator } from '../application-runtime/operationCoordinator'
import { ApplicationToolDispatcher } from '../application-runtime/applicationToolDispatcher'

/** 无协议会话；授权、任务与持久操作均由应用运行时持有。 */
export class LocalMcpServer {
  private http: HttpServer | undefined
  private handler: McpHttpHandler | undefined
  private active = new Map<ServerResponse, string>()
  private port = 0
  private detach?: () => void
  private authorizationTimer?: ReturnType<typeof setInterval>
  private resourceUris = new Set<string>()
  constructor(private readonly connections: McpConnections, private readonly host: ApplicationHostBridge,
    private readonly onError: (error: unknown) => void = () => {}, private readonly operations?: ApplicationOperationCoordinator,
    private readonly onRequest: (info: { callerId: string }) => void = () => {}) {}
  get listening(): boolean { return this.http?.listening === true }
  get listeningPort(): number { return this.port }

  async start(port: number): Promise<void> {
    if (this.http) throw new Error('服务已经启用，请先关闭再更换端口。')
    const handler = createMcpHandler(context => {
      const callerId = context.authInfo?.clientId
      if (!callerId) throw new Error('调用者未获授权。')
      this.connections.assertActive(callerId)
      const server = new Server({ ...EXTERNAL_SERVER_INFO }, { capabilities: { tools: { listChanged: true }, resources: { listChanged: true, subscribe: true } } })
      const dispatcher = new ApplicationToolDispatcher(this.connections, this.host, this.operations, this.port)
      server.setRequestHandler('tools/list', async () => ({ tools: dispatcher.catalog(callerId).tools }))
      server.setRequestHandler('resources/templates/list', async () => ({ resourceTemplates: APPLICATION_RESOURCE_TEMPLATES }))
      server.setRequestHandler('resources/list', async () => ({ resources: [] }))
      server.setRequestHandler('resources/read', async (request, ctx) => {
        const result = await readApplicationResource(dispatcher, callerId, request.params.uri, ctx.mcpReq.signal)
        if (this.resourceUris.size < 512) this.resourceUris.add(request.params.uri)
        return result
      })
      server.setRequestHandler('tools/call', async (request, ctx) => {
        const result = await dispatcher.call(callerId, request.params.name, request.params.arguments, ctx.mcpReq.signal)
        return toMcpResult(result)
      })
      return server
    }, { legacy: 'reject', onerror: this.onError, maxSubscriptions: 16 })
    this.handler = handler
    this.detach = this.host.onChange(() => {
      handler.notify.toolsChanged()
      handler.notify.resourcesChanged()
      for (const uri of this.resourceUris) handler.notify.resourceUpdated(uri)
    })
    this.authorizationTimer = setInterval(() => {
      for (const [response, callerId] of this.active) {
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
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject)
        http.listen(port, '127.0.0.1', () => { http.removeListener('error', reject); resolve() })
      })
      const address = http.address()
      this.port = address && typeof address !== 'string' ? address.port : port
    } catch (error) { this.http = undefined; await handler.close(); this.handler = undefined; throw error }
  }

  async stop(): Promise<void> {
    const http = this.http
    this.http = undefined
    this.detach?.()
    this.detach = undefined
    clearInterval(this.authorizationTimer)
    this.resourceUris.clear()
    // HTTP 关闭只结束这些请求的等待，不能撤销持久业务操作或内置 Pi。
    await this.handler?.close()
    this.handler = undefined
    if (http) await new Promise<void>(resolve => { http.close(() => resolve()); http.closeAllConnections() })
    this.active.clear()
  }

  async revoke(callerId: string): Promise<void> {
    this.host.revoke(callerId)
    await new Promise<void>(resolve => setImmediate(resolve))
    for (const [response, owner] of this.active) if (owner === callerId) response.destroy()
  }

  private reject(response: ServerResponse, status: number): void { response.writeHead(status, { 'Cache-Control': 'no-store' }); response.end() }
  private async handle(request: IncomingMessage & { auth?: AuthInfo }, response: ServerResponse, dispatch: ReturnType<typeof toNodeHandler>): Promise<void> {
    response.setHeader('Cache-Control', 'no-store')
    if (!this.listening || request.url !== '/mcp') return this.reject(response, 404)
    if (request.headers.host !== `127.0.0.1:${this.port}` || request.headers.origin !== undefined) return this.reject(response, 403)
    const authorization = request.headers.authorization
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
    const callerId = this.connections.authenticate(token)
    if (!callerId) return this.reject(response, 401)
    if (request.method !== 'POST') return this.reject(response, 405)
    if (request.headers['mcp-session-id'] !== undefined) return this.reject(response, 400)
    if (this.active.size >= EXTERNAL_LIMITS.concurrentRequests) return this.reject(response, 429)
    if (!request.headers['content-type']?.startsWith('application/json')) return this.reject(response, 415)
    if (Number(request.headers['content-length']) > EXTERNAL_LIMITS.requestBytes) return this.reject(response, 413)
    this.active.set(response, callerId)
    response.once('close', () => this.active.delete(response))
    try {
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
        length += buffer.length
        if (length > EXTERNAL_LIMITS.requestBytes) return this.reject(response, 413)
        chunks.push(buffer)
      }
      let body: unknown
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return this.reject(response, 400) }
      if (Array.isArray(body)) return this.reject(response, 400)
      this.connections.assertActive(callerId)
      request.auth = { token, clientId: callerId, scopes: [] }
      this.onRequest({ callerId })
      await dispatch(request, response, body)
    } finally { if (response.writableEnded || response.destroyed) this.active.delete(response) }
  }
}
