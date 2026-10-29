import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http'
import { connect, type Socket } from 'node:net'
import {
  RELAY_CHALLENGE_HEADER, RELAY_CONTROL_PATH, RELAY_PROTOCOL, RELAY_RETIRE_PATH, createRelayChallenge, isRelayChallenge,
  readHandshakeLine, relayProof, relayProofMatches, type RelayControlMessage, type RelayHello, type RelayLogEntry,
} from './relayProtocol'

/**
 * 接线员：独立于痕迹主进程常驻，长期占住对外 MCP 端口，把请求原样转给当前登记的痕迹后端。
 * 痕迹重启的空档里请求先挂起，后端回来就转过去；鉴权仍由痕迹完成，这里不解析、不记录令牌。
 * 只依赖 Node 内置模块，由 Electron 以 Node 模式运行。
 */
interface RelayOptions {
  /** 对外端口；端口被占用时启动失败，这也保证同一端口只有一个接线员。 */
  port: number
  secret: string
  build: string
  /** 后端缺席时单个请求最多挂起多久。 */
  waitMs?: number
  /** 没有后端、也没有请求持续多久后自行退出。 */
  idleMs?: number
  onExit?: (reason: 'replaced' | 'idle') => void
}

export interface RelayHandle { port: number; close: () => Promise<void> }

interface Backend { port: number; build: string; pid: number; channel: ServerResponse }

const WAIT_MS = 90_000
const IDLE_MS = 30 * 60_000
/** 逐跳头只属于单条连接，转发时去掉，由各自的连接重新决定。 */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade'])
/** 后端一直缺席时积压的日志只留最近这些，等下一个后端登记时补交。 */
const PENDING_LOG_LIMIT = 200

function forwardable(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const listed = new Set(String(headers.connection ?? '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean))
  const result: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name) && !listed.has(name)) result[name] = value
  }
  return result
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined)
      } catch { resolve(undefined) }
    })
    request.on('error', () => resolve(undefined))
  })
}

/** 传输层失败按 MCP 的约定回 JSON-RPC 错误信封，客户端能读到原因，并按 Retry-After 重试。 */
function unavailable(response: ServerResponse, retryAfterSeconds: number, message: string): void {
  if (response.headersSent || response.destroyed) return void response.destroy()
  response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': String(retryAfterSeconds) })
  response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }))
}

function reject(response: ServerResponse, status: number): void { response.writeHead(status); response.end() }

export async function startRelay(options: RelayOptions): Promise<RelayHandle> {
  const waitMs = options.waitMs ?? WAIT_MS
  const idleMs = options.idleMs ?? IDLE_MS
  const backends: Backend[] = []
  const waiters = new Set<() => void>()
  const challenges = new Map<string, number>()
  const pendingLogs: RelayLogEntry[] = []
  let port = options.port
  let inflight = 0
  let lastActivity = Date.now()
  let closing: Promise<void> | undefined

  const send = (backend: Backend, message: RelayControlMessage) => {
    if (!backend.channel.destroyed) backend.channel.write(`${JSON.stringify(message)}\n`)
  }
  const log = (event: Omit<RelayLogEntry, 'at'>) => {
    const entry: RelayLogEntry = { ...event, at: new Date().toISOString() }
    const active = backends[0]
    if (active) return send(active, { type: 'log', ...entry })
    pendingLogs.push(entry)
    if (pendingLogs.length > PENDING_LOG_LIMIT) pendingLogs.shift()
  }
  const wakeWaiters = () => { for (const wake of [...waiters]) wake() }
  const promote = () => {
    const active = backends[0]
    if (!active) return
    send(active, { type: 'state', active: true })
    for (const entry of pendingLogs.splice(0)) send(active, { type: 'log', ...entry })
    wakeWaiters()
  }
  const detach = (backend: Backend) => {
    const index = backends.indexOf(backend)
    if (index < 0) return
    backends.splice(index, 1)
    lastActivity = Date.now()
    log({ level: 'info', event: 'mcp_relay.backend.detached', message: '痕迹后端已离开', context: { pid: backend.pid, remaining: backends.length } })
    if (index === 0) promote()
  }
  const issueChallenge = () => {
    const now = Date.now()
    for (const [value, expiresAt] of challenges) if (expiresAt <= now) challenges.delete(value)
    const challenge = createRelayChallenge()
    challenges.set(challenge, now + 10_000)
    return challenge
  }
  const redeemChallenge = (value: unknown): value is string => {
    if (typeof value !== 'string') return false
    const expiresAt = challenges.get(value)
    challenges.delete(value)
    return expiresAt !== undefined && expiresAt > Date.now()
  }

  /** 先要后端证明知道凭据，再把带令牌的请求发过去。 */
  const connectBackend = async (backendPort: number): Promise<Socket> => {
    const socket = connect(backendPort, '127.0.0.1')
    const challenge = createRelayChallenge()
    socket.once('connect', () => socket.write(`${challenge}\n`))
    const proof = await readHandshakeLine(socket)
    if (!relayProofMatches(relayProof(options.secret, 'connect', challenge), proof)) {
      socket.destroy()
      throw new Error('后端未能证明身份')
    }
    socket.setNoDelay(true)
    return socket
  }

  const waitForBackend = (deadline: number, response: ServerResponse) => new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); waiters.delete(done); response.removeListener('close', done); resolve() }
    const timer = setTimeout(done, Math.max(0, deadline - Date.now()))
    waiters.add(done)
    response.once('close', done)
  })

  /** 请求与响应都按块直通，不攒整段；任一端断开都切断另一端，后端借此取消正在执行的调用。 */
  const proxy = (request: IncomingMessage, response: ServerResponse, socket: Socket) => new Promise<void>(resolve => {
    const upstream = httpRequest({ method: request.method, path: request.url, headers: forwardable(request.headers), createConnection: () => socket })
    upstream.on('response', reply => {
      response.writeHead(reply.statusCode ?? 502, forwardable(reply.headers))
      response.flushHeaders()
      reply.pipe(response)
      reply.once('close', () => { if (!reply.complete) response.destroy() })
    })
    upstream.on('error', () => {
      if (response.headersSent) response.destroy()
      else unavailable(response, 1, '痕迹AI 连接中断，请重试。')
    })
    response.once('close', () => { if (!response.writableFinished) upstream.destroy(); resolve() })
    request.pipe(upstream)
  })

  const forward = async (request: IncomingMessage, response: ServerResponse) => {
    inflight++
    lastActivity = Date.now()
    const startedAt = Date.now()
    const deadline = startedAt + waitMs
    let waited = false
    try {
      for (;;) {
        if (response.destroyed) return
        const backend = backends[0]
        if (!backend) {
          if (closing) return unavailable(response, 1, '痕迹AI 的连接正在切换，请重试。')
          if (Date.now() >= deadline) {
            log({ level: 'warn', event: 'mcp_relay.request.timeout', message: '痕迹AI 未在等待时间内回来，已让外部请求稍后重试', context: { waitedMs: Date.now() - startedAt } })
            return unavailable(response, 30, '痕迹AI 暂时没有运行，请打开痕迹AI 后重试。')
          }
          if (!waited) {
            waited = true
            log({ level: 'info', event: 'mcp_relay.request.waiting', message: '痕迹AI 暂时不在，外部请求挂起等待', context: { waitMs } })
          }
          await waitForBackend(deadline, response)
          continue
        }
        let socket: Socket
        try { socket = await connectBackend(backend.port) } catch {
          // 后端内部端口连不上或答不出证明：视同已经离开，等下一次登记。
          if (backends.includes(backend)) {
            log({ level: 'warn', event: 'mcp_relay.backend.unreachable', message: '登记的痕迹后端无法连接，已注销', context: { pid: backend.pid } })
            detach(backend)
            backend.channel.destroy()
          }
          continue
        }
        if (waited) log({ level: 'info', event: 'mcp_relay.request.resumed', message: '痕迹AI 已回来，挂起的外部请求继续转发', context: { waitedMs: Date.now() - startedAt } })
        return await proxy(request, response, socket)
      }
    } finally {
      inflight--
      lastActivity = Date.now()
    }
  }

  const hello = (request: IncomingMessage, response: ServerResponse) => {
    const challenge = request.headers[RELAY_CHALLENGE_HEADER]
    if (!isRelayChallenge(challenge)) return reject(response, 400)
    const body: RelayHello = { protocol: RELAY_PROTOCOL, build: options.build, pid: process.pid, backends: backends.length, challenge: issueChallenge(), proof: relayProof(options.secret, 'relay', challenge) }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }

  const attach = async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readJson(request)
    const backendPort = body?.port
    if (!redeemChallenge(body?.challenge) || typeof backendPort !== 'number' || !Number.isInteger(backendPort)
      || !relayProofMatches(relayProof(options.secret, 'attach', body.challenge as string, backendPort), body?.proof)) {
      log({ level: 'warn', event: 'mcp_relay.backend.rejected', message: '拒绝了未能证明身份的后端登记' })
      return reject(response, 403)
    }
    const backend: Backend = { port: backendPort, build: String(body.build ?? ''), pid: Number(body.pid ?? 0), channel: response }
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    response.flushHeaders()
    request.socket.setNoDelay(true)
    backends.push(backend)
    lastActivity = Date.now()
    const standby = backends.length > 1
    if (standby) send(backend, { type: 'state', active: false })
    else promote()
    log({ level: 'info', event: 'mcp_relay.backend.attached', message: standby ? '痕迹后端已登记，排队待命' : '痕迹后端已登记', context: { pid: backend.pid, build: backend.build, standby } })
    response.once('close', () => detach(backend))
  }

  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    // 与痕迹内的 MCP 服务同样只认本机地址、拒绝浏览器页面发起的请求；后端仍会再查一遍。
    if (request.headers.host !== `127.0.0.1:${port}` || request.headers.origin !== undefined) return reject(response, 403)
    if (request.url === '/mcp') return void forward(request, response)
    if (request.url === RELAY_CONTROL_PATH && request.method === 'GET') return hello(request, response)
    if (request.url === RELAY_CONTROL_PATH && request.method === 'POST') return void attach(request, response)
    if (request.url === RELAY_RETIRE_PATH && request.method === 'POST') {
      return void readJson(request).then(body => {
        if (!redeemChallenge(body?.challenge) || !relayProofMatches(relayProof(options.secret, 'retire', body.challenge as string), body?.proof)) return reject(response, 403)
        response.writeHead(202)
        response.end(() => { void shutdown('replaced') })
      })
    }
    reject(response, 404)
  })
  // 挂起期间不读请求体；整段请求的超时要留出等待时间。
  server.requestTimeout = waitMs + 30_000
  server.headersTimeout = 10_000

  const shutdown = (reason: 'replaced' | 'idle' | 'closed'): Promise<void> => {
    closing ??= (async () => {
      clearInterval(idleTimer)
      server.close()
      // 先让挂起的请求回 503，再断开其余连接（含后端控制连接与在途转发）。
      wakeWaiters()
      await new Promise(resolve => setImmediate(resolve))
      for (const backend of backends.splice(0)) backend.channel.destroy()
      server.closeAllConnections()
      if (reason !== 'closed') options.onExit?.(reason)
    })()
    return closing
  }

  const idleTimer = setInterval(() => {
    if (backends.length === 0 && inflight === 0 && Date.now() - lastActivity >= idleMs) void shutdown('idle')
  }, Math.min(60_000, idleMs))

  try {
    await new Promise<void>((resolve, fail) => {
      server.once('error', fail)
      server.listen(options.port, '127.0.0.1', () => { server.removeListener('error', fail); resolve() })
    })
  } catch (error) {
    clearInterval(idleTimer)
    throw error
  }
  const address = server.address()
  port = address && typeof address !== 'string' ? address.port : options.port
  log({ level: 'info', event: 'mcp_relay.started', message: '接线员已启动', context: { pid: process.pid, build: options.build, port } })
  return { port, close: () => shutdown('closed') }
}
