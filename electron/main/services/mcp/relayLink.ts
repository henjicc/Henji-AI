import { spawn } from 'node:child_process'
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'
import { createServer, type Server, type Socket } from 'node:net'
import type { MainLogger } from '../logging'
import {
  RELAY_CHALLENGE_HEADER, RELAY_CONTROL_PATH, RELAY_PORT_ENV, RELAY_PROTOCOL, RELAY_RETIRE_PATH, RELAY_SECRET_ENV,
  createRelayChallenge, isRelayChallenge, readHandshakeLine, relayBuildOf, relayProof, relayProofMatches,
  type RelayControlMessage, type RelayHello,
} from './relayProtocol'

/**
 * 痕迹这一侧的接线：在本机随机端口开内部入口，向对外端口上的接线员登记，并保持一条控制连接。
 * 接线员没在跑就拉起；代码版本不同且没有别的痕迹在用时替换；控制连接断了就重新接上。
 */
export interface RelayLink {
  /** `release` 为真时请接线员一并退出，让对外端口立即空出来（关闭外部连接时用）。 */
  stop: (options?: { release?: boolean }) => Promise<void>
}

/** 返回 undefined 表示接线员不可用，调用方退回由痕迹直接监听对外端口。 */
export type McpRelayConnector = (publicPort: number, serve: (socket: Socket) => void) => Promise<RelayLink | undefined>

interface RelayConnectorOptions {
  /** 构建出的接线员入口文件。 */
  script: string
  secret: () => string
  logger: MainLogger
  /** 接线员自身的事件经控制连接送回，写进这个 logger。 */
  relayLogger: MainLogger
  launch?: (script: string, port: number, secret: string) => Promise<void>
}

type Probe = { kind: 'absent' } | { kind: 'foreign' } | { kind: 'relay'; hello: RelayHello }

/**
 * 启动器只负责拉起接线员后立即退出：接线员的父进程随之消失，结束痕迹的进程树（开发版重启、崩溃）时不会连带结束它。
 * 固定代码，不接受调用方传入的脚本内容。
 */
const LAUNCHER = `
const { spawn } = require('node:child_process');
spawn(process.execPath, [process.argv[1]], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
`

function launchRelay(script: string, port: number, secret: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const launcher = spawn(process.execPath, ['-e', LAUNCHER, script], {
      stdio: 'ignore', windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', [RELAY_PORT_ENV]: String(port), [RELAY_SECRET_ENV]: secret },
    })
    launcher.once('error', reject)
    launcher.once('exit', code => { if (code === 0) resolve(); else reject(new Error(`接线员启动器退出码 ${code}`)) })
  })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function probe(port: number, secret: string): Promise<Probe> {
  return new Promise(resolve => {
    const challenge = createRelayChallenge()
    const request = httpRequest({ host: '127.0.0.1', port, path: RELAY_CONTROL_PATH, method: 'GET', headers: { [RELAY_CHALLENGE_HEADER]: challenge }, timeout: 2_000 }, response => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('error', () => resolve({ kind: 'foreign' }))
      response.on('end', () => {
        try {
          const hello = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RelayHello
          if (response.statusCode === 200 && relayProofMatches(relayProof(secret, 'relay', challenge), hello.proof) && isRelayChallenge(hello.challenge)) {
            return resolve({ kind: 'relay', hello })
          }
        } catch { /* 不是接线员的回应 */ }
        resolve({ kind: 'foreign' })
      })
    })
    request.on('timeout', () => request.destroy(new Error('timeout')))
    request.on('error', error => resolve((error as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? { kind: 'absent' } : { kind: 'foreign' }))
    request.end()
  })
}

async function probeUntil(port: number, secret: string, settled: (probe: Probe) => boolean, timeoutMs: number): Promise<Probe> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = await probe(port, secret)
    if (settled(found) || Date.now() >= deadline) return found
    await sleep(100)
  }
}

function post(port: number, path: string, body: unknown): { request: ClientRequest; response: Promise<IncomingMessage> } {
  const payload = JSON.stringify(body)
  const request = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } })
  const response = new Promise<IncomingMessage>((resolve, reject) => { request.once('response', resolve); request.once('error', reject) })
  request.end(payload)
  return { request, response }
}

export function createRelayConnector(options: RelayConnectorOptions): McpRelayConnector {
  const { logger, relayLogger } = options
  const launch = options.launch ?? launchRelay
  return async (publicPort, serve) => {
    let build: string
    let secret: string
    try {
      build = relayBuildOf(options.script)
      secret = options.secret()
    } catch (error) {
      logger.warn('接线员程序或凭据不可用，改由痕迹直接监听', { event: 'mcp.relay.unavailable', error })
      return undefined
    }

    // 握手只让接线员确认对面是痕迹；别的程序直接连内部入口也照样要过痕迹 HTTP 层的鉴权、Host 与 Origin 校验。
    const sockets = new Set<Socket>()
    const internal: Server = createServer(socket => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      readHandshakeLine(socket).then(challenge => {
        if (!isRelayChallenge(challenge)) return void socket.destroy()
        socket.write(`${relayProof(secret, 'connect', challenge)}\n`)
        socket.setNoDelay(true)
        serve(socket)
      }, () => undefined)
    })
    await new Promise<void>((resolve, reject) => {
      internal.once('error', reject)
      internal.listen(0, '127.0.0.1', () => { internal.removeListener('error', reject); resolve() })
    })
    const address = internal.address()
    const internalPort = address && typeof address !== 'string' ? address.port : 0
    let stopped = false
    let channel: ClientRequest | undefined
    let active: boolean | undefined

    const closeInternal = () => {
      internal.close()
      for (const socket of sockets) socket.destroy()
    }

    /** 找到可登记的接线员，返回它的问候；失败返回原因。 */
    const ensureRelay = async (startup: boolean): Promise<RelayHello | string> => {
      let found = await probe(publicPort, secret)
      // 版本替换只在本进程启动时做：重连时也替换的话，两个不同版本的痕迹会互相把对方的接线员换掉。
      if (startup && found.kind === 'relay' && found.hello.build !== build && (found.hello.backends === 0 || found.hello.protocol < RELAY_PROTOCOL)) {
        const previous = found.hello
        const { response } = post(publicPort, RELAY_RETIRE_PATH, { challenge: previous.challenge, proof: relayProof(secret, 'retire', previous.challenge) })
        const status = await response.then(reply => { reply.resume(); return reply.statusCode }, () => undefined)
        if (status === 202) {
          logger.info('已让旧版本接线员退出，换用当前版本', { event: 'mcp.relay.replaced', context: { from: previous.build, to: build, pid: previous.pid } })
          found = await probeUntil(publicPort, secret, next => !(next.kind === 'relay' && next.hello.pid === previous.pid), 5_000)
        }
      }
      if (found.kind === 'absent') {
        try {
          await launch(options.script, publicPort, secret)
          logger.info('已拉起接线员', { event: 'mcp.relay.spawned', context: { build, port: publicPort } })
        } catch (error) {
          logger.warn('拉起接线员失败', { event: 'mcp.relay.spawn_failed', error })
          return 'spawn_failed'
        }
        found = await probeUntil(publicPort, secret, next => next.kind !== 'absent', 5_000)
      }
      if (found.kind !== 'relay') return found.kind === 'foreign' ? 'port_in_use' : 'not_started'
      if (found.hello.protocol !== RELAY_PROTOCOL) return 'protocol_mismatch'
      return found.hello
    }

    const handle = (message: RelayControlMessage) => {
      if (message.type === 'log') return relayLogger[message.level](message.message, { event: message.event, context: { ...message.context, occurredAt: message.at } })
      if (message.active === active) return
      active = message.active
      logger.info(active ? '接线员已把外部请求交给本进程' : '接线员已接上，另一个痕迹正在服务，本进程待命', { event: 'mcp.relay.attached', context: { active, port: publicPort } })
    }

    const attach = async (hello: RelayHello) => {
      const { request, response } = post(publicPort, RELAY_CONTROL_PATH, {
        challenge: hello.challenge, proof: relayProof(secret, 'attach', hello.challenge, internalPort), port: internalPort, build, pid: process.pid,
      })
      const reply = await response
      if (reply.statusCode !== 200) { reply.resume(); throw new Error(`接线员拒绝登记：${reply.statusCode}`) }
      if (stopped) return void request.destroy()
      channel = request
      active = undefined
      let buffer = ''
      reply.setEncoding('utf8')
      reply.on('data', (text: string) => {
        buffer += text
        for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
          const line = buffer.slice(0, end)
          buffer = buffer.slice(end + 1)
          try { handle(JSON.parse(line) as RelayControlMessage) } catch { /* 忽略无法解析的行 */ }
        }
      })
      reply.on('error', () => undefined)
      request.on('error', () => undefined)
      reply.once('close', () => {
        if (channel !== request) return
        channel = undefined
        if (!stopped) void reconnect()
      })
    }

    const reconnect = async () => {
      logger.warn('与接线员的连接断开，正在重新接上', { event: 'mcp.relay.reconnecting', context: { port: publicPort } })
      let reported = false
      for (let delay = 500; !stopped; delay = Math.min(delay * 2, 5_000)) {
        await sleep(delay)
        if (stopped) return
        const hello = await ensureRelay(false)
        let reason = typeof hello === 'string' ? hello : ''
        if (typeof hello !== 'string') {
          try { await attach(hello); return } catch (error) { reason = error instanceof Error ? error.message : 'attach_failed' }
        }
        if (!reported) {
          reported = true
          logger.warn('暂时接不上接线员，继续重试', { event: 'mcp.relay.reconnect_failed', context: { reason } })
        }
      }
    }

    const fallback = (reason: string, error?: unknown) => {
      logger.warn('接线员不可用，改由痕迹直接监听', { event: 'mcp.relay.unavailable', context: { reason, port: publicPort }, error })
      closeInternal()
      return undefined
    }
    const hello = await ensureRelay(true)
    if (typeof hello === 'string') return fallback(hello)
    try { await attach(hello) } catch (error) { return fallback('attach_failed', error) }

    return {
      stop: async ({ release = false } = {}) => {
        stopped = true
        channel?.destroy()
        channel = undefined
        closeInternal()
        if (!release) return
        const found = await probe(publicPort, secret)
        if (found.kind !== 'relay') return
        const { response } = post(publicPort, RELAY_RETIRE_PATH, { challenge: found.hello.challenge, proof: relayProof(secret, 'retire', found.hello.challenge) })
        await response.then(reply => { reply.resume(); logger.info('已关闭接线员', { event: 'mcp.relay.released', context: { port: publicPort } }) }, () => undefined)
        await probeUntil(publicPort, secret, next => next.kind !== 'relay', 5_000)
      },
    }
  }
}
