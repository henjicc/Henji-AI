import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { MCP_READ_CAPABILITY_IDS } from '../../../../src/core/application-control/localHostContracts'
import type { McpConnections } from './connections'
import type { ApplicationHostBridge } from './applicationHostBridge'
import type { McpOperationCoordinator } from './operationCoordinator'
import { z } from 'zod'

type Session = { callerId: string; server: Server; transport: StreamableHTTPServerTransport; touched: number }
const MAX_BODY = 256 * 1024
const MAX_RESULT = 2 * 1024 * 1024

export class LocalMcpServer {
  private http: HttpServer | undefined
  private sessions = new Map<string, Session>()
  private active = 0
  private port = 0
  constructor(private readonly connections: McpConnections, private readonly host: ApplicationHostBridge, private readonly onError: (error: unknown) => void = () => {}, private readonly operations?: McpOperationCoordinator) {}
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
  private createSession(callerId: string): Session {
    const server = new Server({ name: 'henji', version: '1.0.0' }, { capabilities: { tools: {} } })
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID, enableJsonResponse: true,
      onsessioninitialized: (id) => { this.sessions.set(id, session) },
      onsessionclosed: (id) => { this.sessions.delete(id) },
    })
    const session: Session = { callerId, server, transport, touched: Date.now() }
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.connections.assertActive(callerId)
      if (!this.host.ready) throw new Error('应用尚未就绪，请稍后重试。')
      const access = this.connections.access(callerId)
      const tools = this.host.tools().filter((tool) => tool.id !== 'retry_canvas_project_save' && (tool.id !== 'change_application_entities' || (access.allowWrites && this.operations))).map((tool): Tool => {
        const write = tool.id === 'change_application_entities'
        const schema = { ...tool.inputSchema }
        if (write) {
          const properties = { ...schema.properties as Record<string, unknown> }
          delete properties.expectedRevisions
          properties.operationId = { type: 'string', format: 'uuid', description: '调用前生成并保存的逻辑操作标识；丢响应后复用此值查询，不得重新生成重放。' }
          properties.baselineIds = { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 32 }
          schema.properties = properties
          schema.required = [...(schema.required as string[] ?? []).filter((key) => key !== 'expectedRevisions'), 'operationId', 'baselineIds']
        }
        return { name: tool.id, title: tool.title, description: tool.description, inputSchema: { ...schema, type: 'object' }, annotations: { readOnlyHint: !write, destructiveHint: write, openWorldHint: false } }
      })
      if (this.operations && access.allowWrites) tools.push({ name: 'get_application_operation', description: '读取本连接操作的持久事实；未知状态不会重放修改。', inputSchema: { type: 'object', properties: { operationId: { type: 'string', format: 'uuid' } }, required: ['operationId'], additionalProperties: false }, annotations: { readOnlyHint: true } })
      if (this.operations && access.allowWrites) tools.push({ name: 'retry_application_operation_save', description: '按原操作记录仅重试保存并核对原条件；不会重放业务修改，必须保留原编辑会话。', inputSchema: { type: 'object', properties: { operationId: { type: 'string', format: 'uuid' }, originalOperationId: { type: 'string', format: 'uuid' } }, required: ['operationId', 'originalOperationId'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false } })
      return { tools }
    })
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      this.connections.assertActive(callerId)
      if (request.params.name === 'get_application_operation' && this.operations) {
        const { operationId } = z.object({ operationId: z.string().uuid() }).strict().parse(request.params.arguments)
        const operation = this.operations.store.get(operationId, callerId)
        const result = operation ? this.operations.result(operation) : { ok: false, executionState: 'not_found', message: '未找到已登记操作；这不是业务未执行的证明。' }
        return { isError: result.ok !== true, structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }
      }
      if (['change_application_entities', 'retry_application_operation_save'].includes(request.params.name) && this.operations) {
        try {
          const access = this.connections.access(callerId)
          const operation = request.params.name === 'retry_application_operation_save'
            ? this.operations.prepareSaveRecovery(callerId, request.params.arguments ?? {}, this.host.sessionId, access)
            : this.operations.prepare(callerId, request.params.arguments ?? {}, this.host.sessionId, access)
          if (operation.state === 'prepared') {
            this.connections.assertActive(callerId)
            try { await this.host.execute(callerId, operation.capabilityId ?? 'change_application_entities', operation.input, extra.signal, { operation, ...access }) } catch { /* 持久操作状态决定结果，等待失败不能覆盖事实。 */ }
          }
          this.connections.assertActive(callerId)
          const result = this.operations.result(this.operations.store.get(operation.operationId, callerId)!)
          return { isError: result.ok !== true, structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }
        } catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : '写入未完成。' }] } }
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
