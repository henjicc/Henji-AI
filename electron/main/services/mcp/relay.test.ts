// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { connect, createServer as createNetServer, type Server, type Socket } from 'node:net'
import { startRelay, type RelayHandle } from './relay'
import { createRelayConnector, type RelayLink } from './relayLink'
import { RELAY_CHALLENGE_HEADER, RELAY_CONTROL_PATH, createRelayChallenge, relayBuildOf, relayProof, type RelayHello } from './relayProtocol'
import type { MainLogger } from '../logging'

const SECRET = 'a'.repeat(64)
const SCRIPT = __filename
const BUILD = relayBuildOf(SCRIPT)
const closers: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const close of closers.reverse()) await close(); closers.length = 0 })

function silentLogger(): MainLogger & { events: string[] } {
  const events: string[] = []
  const write = (_message: string, meta?: { event?: string }) => { events.push(meta?.event ?? '') }
  return { events, trace: write, debug: write, info: write, warn: write, error: write }
}

async function relay(options: { waitMs?: number; port?: number; build?: string } = {}): Promise<RelayHandle> {
  const handle = await startRelay({ port: options.port ?? 0, secret: SECRET, build: options.build ?? BUILD, waitMs: options.waitMs })
  closers.push(() => handle.close())
  return handle
}

/** 在进程内拉起接线员，代替真实的子进程。 */
function inProcessLaunch(started: number[] = []) {
  return async (_script: string, port: number, secret: string) => {
    const handle = await startRelay({ port, secret, build: BUILD })
    started.push(port)
    closers.push(() => handle.close())
  }
}

/** 模拟痕迹后端：一个 HTTP 服务，由接线决定它监听在哪里。 */
async function backend(port: number, handler: (request: IncomingMessage, response: ServerResponse) => void, options: { logger?: MainLogger; launch?: ReturnType<typeof inProcessLaunch> } = {}): Promise<{ link: RelayLink; http: HttpServer }> {
  const logger = options.logger ?? silentLogger()
  const http = createHttpServer(handler)
  const connectRelay = createRelayConnector({ script: SCRIPT, secret: () => SECRET, logger, relayLogger: logger, launch: options.launch })
  const link = await connectRelay(port, http)
  closers.push(async () => { await link.stop(); await new Promise<void>(resolve => { http.close(() => resolve()); http.closeAllConnections() }) })
  return { link, http }
}

function send(port: number, options: { body?: string; headers?: Record<string, string> } = {}) {
  const request = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token', ...options.headers } })
  const response = new Promise<IncomingMessage>((resolve, reject) => { request.once('response', resolve); request.once('error', reject) })
  request.end(options.body ?? '{}')
  return { request, response }
}

function readAll(response: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let text = ''
    response.setEncoding('utf8')
    response.on('data', (chunk: string) => { text += chunk })
    response.on('end', () => resolve(text))
  })
}

async function hello(port: number): Promise<RelayHello> {
  const challenge = createRelayChallenge()
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    httpRequest({ host: '127.0.0.1', port, path: RELAY_CONTROL_PATH, headers: { [RELAY_CHALLENGE_HEADER]: challenge } }, resolve).once('error', reject).end()
  })
  return JSON.parse(await readAll(response)) as RelayHello
}

const echo = (request: IncomingMessage, response: ServerResponse) => {
  void readAll(request).then(body => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ body, authorization: request.headers.authorization, host: request.headers.host }))
  })
}

describe('外部连接接线员', () => {
  it('痕迹不在时挂起请求，后端登记后原样转发，鉴权头交给后端判断', async () => {
    const { port } = await relay()
    const pending = send(port, { body: '{"jsonrpc":"2.0","id":1}' })
    await new Promise(resolve => setTimeout(resolve, 300))
    const logger = silentLogger()
    const { link } = await backend(port, echo, { logger })
    const response = await pending.response
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(await readAll(response))).toEqual({ body: '{"jsonrpc":"2.0","id":1}', authorization: 'Bearer token', host: `127.0.0.1:${port}` })
    expect(logger.events).toEqual(expect.arrayContaining(['mcp_relay.request.waiting', 'mcp_relay.request.resumed']))
    expect(link.state()).toBe('serving')
  })

  it('等不到后端时回 503 与 Retry-After，而不是拒绝连接', async () => {
    const { port } = await relay({ waitMs: 200 })
    const response = await send(port).response
    expect(response.statusCode).toBe(503)
    expect(response.headers['retry-after']).toBe('30')
    expect(JSON.parse(await readAll(response))).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32000 } })
  })

  it('流式响应逐块透传，客户端断开会传到后端', async () => {
    const { port } = await relay()
    let release!: () => void
    const firstChunkSeen = new Promise<void>(resolve => { release = resolve })
    const backendClosed = vi.fn()
    let stream!: ServerResponse
    await backend(port, (request, response) => {
      stream = response
      request.resume()
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write('data: 1\n\n')
      response.once('close', backendClosed)
    })
    const pending = send(port)
    const response = await pending.response
    response.setEncoding('utf8')
    const chunks: string[] = []
    response.on('data', (chunk: string) => { chunks.push(chunk); release() })
    // 第一块到达前后端没有结束响应：收到即证明没有攒整段。
    await firstChunkSeen
    expect(stream.writableEnded).toBe(false)
    expect(chunks.join('')).toBe('data: 1\n\n')
    pending.request.destroy()
    await vi.waitFor(() => expect(backendClosed).toHaveBeenCalled())
  })

  it('拒绝答不出凭据证明的后端登记、冒充的内部入口，内部入口也不替陌生来访者作证明', async () => {
    const { port } = await relay({ waitMs: 1_000 })
    const forged = await hello(port)
    const rejected = await new Promise<number | undefined>(resolve => {
      const request = httpRequest({ host: '127.0.0.1', port, path: RELAY_CONTROL_PATH, method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode) })
      const session = createRelayChallenge()
      request.end(JSON.stringify({ challenge: forged.challenge, session, proof: relayProof('b'.repeat(64), 'attach', forged.challenge, 1, session), port: 1 }))
    })
    expect(rejected).toBe(403)

    // 真后端登记过的内部端口在它退出后被别的程序占住：接线员连过去先要证明，拿不到就不发请求。
    const received = vi.fn()
    const impostor: Server = createNetServer((socket: Socket) => { socket.on('data', received); socket.write(`${'0'.repeat(64)}\n`) })
    const impostorPort = await new Promise<number>(resolve => impostor.listen(0, '127.0.0.1', () => resolve((impostor.address() as { port: number }).port)))
    closers.push(() => { impostor.close() })
    const challenge = (await hello(port)).challenge
    const session = createRelayChallenge()
    const attach = httpRequest({ host: '127.0.0.1', port, path: RELAY_CONTROL_PATH, method: 'POST', headers: { 'Content-Type': 'application/json' } })
    attach.on('response', response => response.resume())
    attach.on('error', () => undefined)
    attach.end(JSON.stringify({ challenge, session, proof: relayProof(SECRET, 'attach', challenge, impostorPort, session), port: impostorPort }))
    closers.push(() => { attach.destroy() })
    const response = await send(port).response
    expect(response.statusCode).toBe(503)
    // 冒充者只收到握手行，没有收到任何 HTTP 内容（含授权头）。
    const bytes = received.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(bytes).toMatch(/^[0-9a-f]{32} [0-9a-f]{64}\n$/)

    // 真后端的内部入口：不带本次登记的证明来握手，连接直接被关掉，拿不到任何证明。
    const relay2 = await relay()
    const { http } = await backend(relay2.port, echo)
    const internalPort = (http.address() as { port: number }).port
    const answer = await new Promise<string>(resolve => {
      const socket = connect(internalPort, '127.0.0.1', () => socket.write(`${createRelayChallenge()} ${'1'.repeat(64)}\n`))
      let text = ''
      socket.on('data', chunk => { text += String(chunk) })
      socket.on('close', () => resolve(text))
    })
    expect(answer).toBe('')
  })

  it('同一端口只能有一个接线员，浏览器页面发起的请求被拒绝', async () => {
    const { port } = await relay()
    await expect(startRelay({ port, secret: SECRET, build: BUILD })).rejects.toMatchObject({ code: 'EADDRINUSE' })
    const response = await send(port, { headers: { Origin: 'http://example.com' } }).response
    expect(response.statusCode).toBe(403)
  })
})

describe('痕迹一侧的接线', () => {
  it('换版本时旧接线员把挂起的请求转交新接线员，后端登记到新接线员后照常返回', async () => {
    const outdated = await relay({ build: 'outdated' })
    const port = outdated.port
    const pending = send(port, { body: '{"id":7}' })
    await new Promise(resolve => setTimeout(resolve, 200))
    const logger = silentLogger()
    const launches: number[] = []
    const { link } = await backend(port, echo, { logger, launch: inProcessLaunch(launches) })
    expect(launches).toEqual([port])
    expect(logger.events).toEqual(expect.arrayContaining(['mcp.relay.replaced', 'mcp.relay.spawned']))
    expect((await hello(port)).build).toBe(BUILD)
    const response = await pending.response
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(await readAll(response)).body).toBe('{"id":7}')
    expect(link.state()).toBe('serving')
  })

  it('还有别的痕迹登记着时，关闭外部连接不会让接线员退出', async () => {
    const { port } = await relay()
    const first = await backend(port, echo)
    const second = await backend(port, echo)
    expect(second.link.state()).toBe('standby')
    await second.link.stop({ release: true })
    expect((await hello(port)).backends).toBe(1)
    expect(first.link.state()).toBe('serving')
  })

  it('端口被别的程序占着时不抢端口、如实报告，对方让出后自动拉起接线员接上', async () => {
    const foreign = createHttpServer((_request, response) => { response.writeHead(404); response.end() })
    const port = await new Promise<number>(resolve => foreign.listen(0, '127.0.0.1', () => resolve((foreign.address() as { port: number }).port)))
    const { link } = await backend(port, echo, { launch: inProcessLaunch() })
    expect(link.state()).toBe('port_in_use')
    await new Promise<void>(resolve => { foreign.close(() => resolve()); foreign.closeAllConnections() })
    await vi.waitFor(() => expect(link.state()).toBe('serving'), { timeout: 10_000 })
    const response = await send(port).response
    expect(response.statusCode).toBe(200)
  })

  it('临时进程不拉起接线员，端口空着时直接监听', async () => {
    const probe = createNetServer()
    const port = await new Promise<number>(resolve => probe.listen(0, '127.0.0.1', () => resolve((probe.address() as { port: number }).port)))
    await new Promise<void>(resolve => probe.close(() => resolve()))
    const { link, http } = await backend(port, echo)
    expect(link.state()).toBe('direct')
    expect((http.address() as { port: number }).port).toBe(port)
    expect((await send(port).response).statusCode).toBe(200)
  })
})
