// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createNetServer, type Server, type Socket } from 'node:net'
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

async function relay(options: { waitMs?: number; port?: number } = {}): Promise<RelayHandle> {
  const handle = await startRelay({ port: options.port ?? 0, secret: SECRET, build: BUILD, waitMs: options.waitMs })
  closers.push(() => handle.close())
  return handle
}

/** 模拟痕迹后端：一个不监听的 HTTP 服务，由接线连接把握手过的连接交给它。 */
async function backend(port: number, handler: (request: IncomingMessage, response: ServerResponse) => void, logger = silentLogger()): Promise<RelayLink> {
  const http = createHttpServer(handler)
  const connect = createRelayConnector({ script: SCRIPT, secret: () => SECRET, logger, relayLogger: logger, launch: async () => { throw new Error('测试里不拉起进程') } })
  const link = await connect(port, socket => http.emit('connection', socket))
  if (!link) throw new Error('没有接上接线员')
  closers.push(() => link.stop())
  return link
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

describe('外部连接接线员', () => {
  it('痕迹不在时挂起请求，后端登记后原样转发，鉴权头交给后端判断', async () => {
    const { port } = await relay()
    const pending = send(port, { body: '{"jsonrpc":"2.0","id":1}' })
    await new Promise(resolve => setTimeout(resolve, 300))
    const logger = silentLogger()
    await backend(port, (request, response) => {
      void readAll(request).then(body => {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ body, authorization: request.headers.authorization, host: request.headers.host }))
      })
    }, logger)
    const response = await pending.response
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(await readAll(response))).toEqual({ body: '{"jsonrpc":"2.0","id":1}', authorization: 'Bearer token', host: `127.0.0.1:${port}` })
    expect(logger.events).toEqual(expect.arrayContaining(['mcp_relay.request.waiting', 'mcp_relay.request.resumed']))
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

  it('拒绝答不出凭据证明的后端登记与冒充的内部入口', async () => {
    const { port } = await relay({ waitMs: 1_000 })
    const forged = await hello(port)
    const rejected = await new Promise<number | undefined>(resolve => {
      const request = httpRequest({ host: '127.0.0.1', port, path: RELAY_CONTROL_PATH, method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode) })
      request.end(JSON.stringify({ challenge: forged.challenge, proof: relayProof('b'.repeat(64), 'attach', forged.challenge, 1), port: 1 }))
    })
    expect(rejected).toBe(403)

    // 真后端登记过的内部端口在它退出后被别的程序占住：接线员连过去先要证明，拿不到就不发请求。
    const received = vi.fn()
    const impostor: Server = createNetServer((socket: Socket) => { socket.on('data', received); socket.write(`${'0'.repeat(64)}
`) })
    const internalPort = await new Promise<number>(resolve => impostor.listen(0, '127.0.0.1', () => resolve((impostor.address() as { port: number }).port)))
    closers.push(() => { impostor.close() })
    const challenge = (await hello(port)).challenge
    const attach = httpRequest({ host: '127.0.0.1', port, path: RELAY_CONTROL_PATH, method: 'POST', headers: { 'Content-Type': 'application/json' } })
    attach.on('response', response => response.resume())
    attach.on('error', () => undefined)
    attach.end(JSON.stringify({ challenge, proof: relayProof(SECRET, 'attach', challenge, internalPort), port: internalPort }))
    closers.push(() => { attach.destroy() })
    const response = await send(port).response
    expect(response.statusCode).toBe(503)
    // 冒充者只收到握手用的挑战值，没有收到任何 HTTP 内容（含授权头）。
    const bytes = received.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(bytes).toMatch(/^[0-9a-f]{32}\n$/)
  })

  it('同一端口只能有一个接线员，浏览器页面发起的请求被拒绝', async () => {
    const { port } = await relay()
    await expect(startRelay({ port, secret: SECRET, build: BUILD })).rejects.toMatchObject({ code: 'EADDRINUSE' })
    const response = await send(port, { headers: { Origin: 'http://example.com' } }).response
    expect(response.statusCode).toBe(403)
  })
})

describe('痕迹一侧的接线', () => {
  it('没有接线员时拉起，代码版本不同且无人使用时替换旧接线员', async () => {
    let started: RelayHandle | undefined
    const launches: number[] = []
    const logger = silentLogger()
    const launch = async (_script: string, port: number, secret: string) => {
      launches.push(port)
      started = await startRelay({ port, secret, build: BUILD })
      closers.push(() => started?.close())
    }
    const outdated = await startRelay({ port: 0, secret: SECRET, build: 'outdated' })
    closers.push(() => outdated.close())
    const port = outdated.port
    const connect = createRelayConnector({ script: SCRIPT, secret: () => SECRET, logger, relayLogger: logger, launch })
    const link = await connect(port, socket => socket.destroy())
    closers.push(() => link?.stop())
    expect(link).toBeDefined()
    expect(launches).toEqual([port])
    expect(logger.events).toEqual(expect.arrayContaining(['mcp.relay.replaced', 'mcp.relay.spawned']))
    expect((await hello(port)).build).toBe(BUILD)
  })
})
