import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { EXTERNAL_LIMITS, EXTERNAL_SERVER_INFO, MCP_READ_CAPABILITY_IDS, MCP_WRITE_CAPABILITY_IDS } from '../../../../src/core/application-control/localHostContracts'
import { buildApplicationContract, buildMcpToolCatalog, describeContractInputSchema, invalidInputMessage, readMediaInputSchema } from './toolCatalog'
import type { McpConnections } from './connections'
import type { ApplicationHostBridge } from './applicationHostBridge'
import type { McpOperationCoordinator } from './operationCoordinator'
import { z } from 'zod'
import { readMcpMediaResource, McpMediaResourceError } from './mediaResources'

type Session = { callerId: string; server: Server; transport: StreamableHTTPServerTransport; touched: number }
const MAX_BODY = EXTERNAL_LIMITS.requestBytes
const MAX_RESULT = EXTERNAL_LIMITS.resultBytes

export class LocalMcpServer {
  private http: HttpServer | undefined
  private sessions = new Map<string, Session>()
  private active = 0
  private port = 0
  /**
   * `onSession` 是"到底有没有客户端真的连上来"的唯一可观察出口。
   * 在此之前，握手成功与配置写对了完全不可区分：外部客户端的配置回显里也会出现同一个
   * url 和令牌变量名，误读成"已连接"。现在由服务端在 initialize 完成后记账，
   * 并带上客户端自报的名称与版本（只作记录，不参与任何授权判断）。
   */
  constructor(private readonly connections: McpConnections, private readonly host: ApplicationHostBridge, private readonly onError: (error: unknown) => void = () => {}, private readonly operations?: McpOperationCoordinator,
    private readonly onSession: (info: { callerId: string; client?: { name: string; version: string } }) => void = () => {}) {}
  get listening(): boolean { return this.http?.listening === true }
  get listeningPort(): number { return this.port }
  async start(port: number): Promise<void> {
    if (this.http) throw new Error('服务已经启用，请先关闭再更换端口。')
    const http = createServer((request, response) => { void this.handle(request, response).catch((error) => { this.onError(error); if (!response.headersSent) response.writeHead(500); response.end() }) })
    http.requestTimeout = 15_000
    http.headersTimeout = 10_000
    this.http = http
    try {
      await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(port, '127.0.0.1', () => { http.removeListener('error', reject); resolve() }) })
      const address = http.address()
      this.port = address && typeof address !== 'string' ? address.port : port
    } catch (error) { this.http = undefined; throw error }
  }
  async stop(): Promise<void> {
    const http = this.http
    this.http = undefined
    this.host.cancelPending()
    await Promise.all([...this.sessions.values()].map((session) => session.server.close()))
    this.sessions.clear()
    if (http) await new Promise<void>((resolve) => { http.close(() => resolve()); http.closeAllConnections() })
  }
  async revoke(callerId: string): Promise<void> {
    this.host.revoke(callerId)
    // 让已拒绝的在途只读调用先发送错误回执，再释放协议会话。
    await new Promise<void>((resolve) => setImmediate(resolve))
    for (const [id, session] of this.sessions) if (session.callerId === callerId) { await session.server.close(); this.sessions.delete(id) }
  }
  private reject(response: ServerResponse, status: number): void { response.writeHead(status, { 'Cache-Control': 'no-store' }); response.end() }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store')
    if (!this.listening || request.url !== '/mcp') return this.reject(response, 404)
    if (request.headers.host !== `127.0.0.1:${this.port}` || request.headers.origin !== undefined) return this.reject(response, 403)
    const authorization = request.headers.authorization
    const callerId = this.connections.authenticate(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '')
    if (!callerId) return this.reject(response, 401)
    // 首版只返回 JSON，不开启可被重复 GET 无限占用的常驻 SSE 通道。
    if (request.method === 'GET') return this.reject(response, 405)
    if (this.active >= 8) return this.reject(response, 429)
    if (!['POST', 'GET', 'DELETE'].includes(request.method ?? '')) return this.reject(response, 405)
    const sessionId = request.headers['mcp-session-id']
    if (Array.isArray(sessionId)) return this.reject(response, 400)
    const existing = sessionId ? this.sessions.get(sessionId) : undefined
    if (sessionId && (!existing || existing.callerId !== callerId)) return this.reject(response, 404)
    this.active++
    try {
      let body: unknown
      if (request.method === 'POST') {
        if (!request.headers['content-type']?.startsWith('application/json')) return this.reject(response, 415)
        if (Number(request.headers['content-length']) > MAX_BODY) return this.reject(response, 413)
        const chunks: Buffer[] = []
        let length = 0
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
          length += buffer.length
          if (length > MAX_BODY) return this.reject(response, 413)
          chunks.push(buffer)
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return this.reject(response, 400) }
        if (Array.isArray(body)) return this.reject(response, 400)
      }
      this.connections.assertActive(callerId)
      let session = existing
      if (!session) {
        if (request.method !== 'POST' || !isInitializeRequest(body)) return this.reject(response, 400)
        if (!this.host.ready) return this.reject(response, 503)
        for (const [id, stale] of this.sessions) if (Date.now() - stale.touched > 30 * 60_000) { await stale.server.close(); this.sessions.delete(id) }
        if (this.sessions.size >= 16) return this.reject(response, 429)
        session = this.createSession(callerId)
        await session.server.connect(session.transport)
      }
      session.touched = Date.now()
      await session.transport.handleRequest(request, response, body)
    } finally { this.active-- }
  }
  private catalog(callerId: string) {
    this.connections.assertActive(callerId)
    if (!this.host.ready) throw new Error('应用尚未就绪，请稍后重试。')
    return buildMcpToolCatalog({ tools: this.host.tools(), access: this.connections.access(callerId), operationsEnabled: Boolean(this.operations) })
  }
  private createSession(callerId: string): Session {
    const server = new Server({ ...EXTERNAL_SERVER_INFO }, { capabilities: { tools: {} } })
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID, enableJsonResponse: true,
      onsessioninitialized: (id) => {
        this.sessions.set(id, session)
        // 传输层在把 initialize 交给协议层之前就回调这里，此刻还读不到客户端自报身份；
        // 推迟一轮再读，拿不到就如实记未知，不为了好看而猜。
        setImmediate(() => {
          const client = server.getClientVersion()
          this.onSession({ callerId, client: client ? { name: String(client.name), version: String(client.version) } : undefined })
        })
      },
      onsessionclosed: (id) => { this.sessions.delete(id) },
    })
    const session: Session = { callerId, server, transport, touched: Date.now() }
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      // 每次列举都按当前注册重新投影：渲染层重载、重新注册或撤销后再次 tools/list 就是最新目录。
      return { tools: this.catalog(callerId).tools }
    })
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      this.connections.assertActive(callerId)
      if (request.params.name === 'describe_application_contract') {
        try {
          const { domains } = describeContractInputSchema.parse(request.params.arguments ?? {})
          const data = buildApplicationContract({ domains: this.host.domains(), access: this.connections.access(callerId), catalog: this.catalog(callerId), port: this.port, requestedDomains: domains })
          const result = { ok: true, data }
          // 与其余工具保持同一约定：成功显式给出 isError:false，调用方不必区分 undefined 与 false。
          return { isError: false, structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: invalidInputMessage(error) ?? (error instanceof Error ? error.message : '契约发现失败，请稍后重试。') }] }
        }
      }
      if (request.params.name === 'read_application_media') {
        try {
          const input = readMediaInputSchema.parse(request.params.arguments)
          const result = await readMcpMediaResource(input)
          this.connections.assertActive(callerId)
          return { isError: false, structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }
        } catch (error) {
          // 参数错误点名字段；业务失败仍然脱敏，不回传本地路径。
          const message = invalidInputMessage(error) ?? (error instanceof McpMediaResourceError ? `${error.code}:${error.message}` : '媒体读取失败，请稍后重试。')
          return { isError: true, content: [{ type: 'text', text: message }] }
        }
      }
      if (request.params.name === 'get_application_operation' && this.operations) {
        const parsed = z.object({ operationId: z.string().uuid() }).strict().safeParse(request.params.arguments)
        if (!parsed.success) return { isError: true, content: [{ type: 'text', text: invalidInputMessage(parsed.error)! }] }
        const operation = this.operations.store.get(parsed.data.operationId, callerId)
        const result = operation ? this.operations.result(operation) : { ok: false, executionState: 'not_found', message: '未找到已登记操作；这不是业务未执行的证明。' }
        return { isError: result.ok !== true, structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }
      }
      if ([...MCP_WRITE_CAPABILITY_IDS, 'retry_application_operation_save'].some((id) => id === request.params.name) && this.operations) {
        try {
          const access = this.connections.access(callerId)
          const operation = request.params.name === 'retry_application_operation_save'
            ? this.operations.prepareSaveRecovery(callerId, request.params.arguments ?? {}, this.host.sessionId, access)
            : this.operations.prepare(callerId, request.params.arguments ?? {}, this.host.sessionId, access, MCP_WRITE_CAPABILITY_IDS.find((id) => id === request.params.name))
          if (operation.state === 'prepared') {
            this.connections.assertActive(callerId)
            try { await this.host.execute(callerId, operation.capabilityId ?? 'change_application_entities', operation.input, extra.signal, { operation, ...access }) } catch { /* 持久操作状态决定结果，等待失败不能覆盖事实。 */ }
          }
          this.connections.assertActive(callerId)
          const result = this.operations.result(this.operations.store.get(operation.operationId, callerId)!)
          return { isError: result.ok !== true, structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }
        } catch (error) { return { isError: true, content: [{ type: 'text', text: invalidInputMessage(error) ?? (error instanceof Error ? error.message : '写入未完成。') }] } }
      }
      const id = MCP_READ_CAPABILITY_IDS.find((value) => value === request.params.name)
      if (!id) return { isError: true, content: [{ type: 'text', text: '此连接只允许读取。请用 tools/list 查看可用工具。' }] }
      try {
        const sessionId = this.host.sessionId
        const raw = await this.host.execute(callerId, id, request.params.arguments ?? {}, extra.signal, this.connections.access(callerId))
        const result = this.operations ? this.operations.rememberRead(callerId, raw, sessionId) : raw
        this.connections.assertActive(callerId)
        const text = JSON.stringify(result)
        if (Buffer.byteLength(text) > MAX_RESULT) throw new Error('读取结果过大，请缩小字段或分页读取。')
        return { isError: result.ok !== true, structuredContent: result, content: [{ type: 'text', text }] }
      } catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : '应用读取失败，请稍后重试。' }] } }
    })
    return session
  }
}
