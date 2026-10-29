import { spawn } from 'node:child_process'
import { request as httpRequest, type ClientRequest, type IncomingMessage, type Server as HttpServer } from 'node:http'
import type { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import type { MainLogger } from '../logging'
import type { McpConnectionIssue } from '../../../../src/core/application-control/localHostContracts'
import {
  RELAY_CONTROL_PATH, RELAY_PORT_ENV, RELAY_PROTOCOL, RELAY_RETIRE_PATH, RELAY_SECRET_ENV,
  createRelayChallenge, isRelayChallenge, probeRelay, readHandshakeLine, relayBuildOf, relayProof, relayProofMatches,
  type RelayControlMessage, type RelayHello, type RelayProbe, type RelayRetireMode,
} from './relayProtocol'

/**
 * 痕迹这一侧的接线。对外端口的归属按下面的顺序决定，并在整个运行期间自己维持：
 * - 端口上是自己的接线员：登记上去（版本不同且无人使用时先换成当前版本）；
 * - 端口空着：常驻模式下拉起接线员再登记；拉不起来、或临时进程（助手命令行、隔离资料目录）不拉起时，由痕迹直接监听；
 * - 端口被别的程序或凭据不同的接线员占着、接线员暂时答不上：不抢端口，持续重试，状态如实报给设置界面。
 * 直接监听失败、控制连接断开都回到重试；只有确认端口空着才直接监听。
 */
export type RelayLinkState = 'serving' | 'standby' | 'direct' | McpConnectionIssue

export interface RelayLink {
  state: () => RelayLinkState
  /** `release` 为真时请接线员一并退出（还有别的痕迹在用时它会拒绝），让对外端口空出来。 */
  stop: (options?: { release?: boolean }) => Promise<void>
}

/** 接管 `http` 的监听：经接线员时在本机随机端口接收握手过的连接，直接监听时在对外端口。 */
export type McpRelayConnector = (publicPort: number, http: HttpServer) => Promise<RelayLink>

interface RelayConnectorOptions {
  /** 构建出的接线员入口文件。 */
  script: string
  /** 每次接线都从存储重新读取：另一个痕迹实例可能刚写入了不同的值。 */
  secret: () => string
  logger: MainLogger
  /** 接线员自身的事件经控制连接送回，写进这个 logger。 */
  relayLogger: MainLogger
  /** 拉起接线员；不提供表示本进程是临时的，只登记到已有接线员，不拉起也不替换。 */
  launch?: (script: string, port: number, secret: string) => Promise<void>
}

/**
 * 启动器只负责拉起接线员后立即退出：接线员的父进程随之消失，结束痕迹的进程树（开发版重启、崩溃）时不会连带结束它。
 * 固定代码，不接受调用方传入的脚本内容。
 */
const LAUNCHER = `
const { spawn } = require('node:child_process');
spawn(process.execPath, [process.argv[1]], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
`

/** 工作目录放在系统临时目录：接线员常驻，不能占住开发目录或安装目录。 */
export function launchRelay(script: string, port: number, secret: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const launcher = spawn(process.execPath, ['-e', LAUNCHER, script], {
      cwd: tmpdir(), stdio: 'ignore', windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', [RELAY_PORT_ENV]: String(port), [RELAY_SECRET_ENV]: secret },
    })
    launcher.once('error', reject)
    launcher.once('exit', code => { if (code === 0) resolve(); else reject(new Error(`接线员启动器退出码 ${code}`)) })
  })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const HANDSHAKE_MS = 10_000

async function probeUntil(port: number, secret: string, settled: (probe: RelayProbe) => boolean, timeoutMs: number): Promise<RelayProbe> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = await probeRelay(port, secret)
    if (settled(found) || Date.now() >= deadline) return found
    await sleep(100)
  }
}

/** 登记与请接线员退出都在 5 秒内要有回应；登记成功后的控制连接是长连接，收到回应即取消超时。 */
function post(port: number, path: string, body: unknown): { request: ClientRequest; response: Promise<IncomingMessage> } {
  const payload = JSON.stringify(body)
  const request = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } })
  request.setTimeout(5_000, () => request.destroy(new Error('接线员没有回应')))
  const response = new Promise<IncomingMessage>((resolve, reject) => {
    request.once('response', reply => { request.setTimeout(0); resolve(reply) })
    request.once('error', reject)
  })
  request.end(payload)
  return { request, response }
}

async function retireRelay(port: number, secret: string, hello: RelayHello, mode: RelayRetireMode, session = ''): Promise<number | undefined> {
  const { response } = post(port, RELAY_RETIRE_PATH, { challenge: hello.challenge, mode, session, proof: relayProof(secret, 'retire', hello.challenge, mode, session) })
  return response.then(reply => { reply.resume(); return reply.statusCode }, () => undefined)
}

function listen(http: HttpServer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => { http.removeListener('listening', done); reject(error) }
    const done = () => { http.removeListener('error', fail); resolve() }
    http.once('error', fail)
    http.once('listening', done)
    http.listen(port, '127.0.0.1')
  })
}

function close(http: HttpServer): Promise<void> {
  return new Promise(resolve => { http.close(() => resolve()); http.closeAllConnections() })
}

export function createRelayConnector(options: RelayConnectorOptions): McpRelayConnector {
  const { logger, relayLogger } = options
  return async (publicPort, http) => {
    // HTTP 服务自带的连接处理（解析、超时、关闭时逐个断开）保持不变，只在它前面加一道握手。
    const [accept] = http.listeners('connection') as Array<(socket: Socket) => void>
    let secret = ''
    /** 当前登记的会话及登记时用的凭据；握手只认这一对，换登记即作废。 */
    let registration: { session: string; secret: string } | undefined
    const acceptRelayed = (socket: Socket) => {
      readHandshakeLine(socket, HANDSHAKE_MS).then(line => {
        const [challenge, dial] = line.split(' ')
        const current = registration
        if (!current || !isRelayChallenge(challenge) || !relayProofMatches(relayProof(current.secret, 'dial', current.session, challenge), dial)) return void socket.destroy()
        socket.write(`${relayProof(current.secret, 'connect', current.session, challenge)}\n`)
        socket.setNoDelay(true)
        accept.call(http, socket)
      }, () => undefined)
    }
    const acceptVia = (relayed: boolean) => {
      http.removeAllListeners('connection')
      http.on('connection', relayed ? acceptRelayed : accept)
    }

    let mode: 'relay' | 'direct' = 'relay'
    let state: RelayLinkState = 'connecting'
    let stopped = false
    let channel: ClientRequest | undefined
    let internalPort = 0
    let build = ''
    let launch = options.launch
    let maintaining = false
    let queue: Promise<unknown> = Promise.resolve()
    /** 探测、拉起、替换、登记与关闭时请接线员退出互斥，关闭之后不会再拉起。 */
    const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
      const run = queue.then(task, task)
      queue = run.catch(() => undefined)
      return run
    }
    const setState = (next: RelayLinkState, context?: Record<string, unknown>) => {
      if (next === state) return
      state = next
      const meta = { event: 'mcp.relay.state', context: { state: next, port: publicPort, ...context } }
      if (next === 'serving' || next === 'standby' || next === 'direct') logger.info('外部连接已可以对外服务', meta)
      else logger.warn('外部连接暂时无法对外服务，正在重试', meta)
    }

    const listenRelayed = async () => {
      acceptVia(true)
      await listen(http, 0)
      const address = http.address()
      internalPort = address && typeof address !== 'string' ? address.port : 0
    }

    const handle = (message: RelayControlMessage) => {
      if (message.type === 'log') return relayLogger[message.level](message.message, { event: message.event, context: { ...message.context, occurredAt: message.at } })
      setState(message.active ? 'serving' : 'standby')
      onState?.()
    }
    let onState: (() => void) | undefined

    const attach = async (hello: RelayHello): Promise<boolean> => {
      const nextSession = createRelayChallenge()
      const { request, response } = post(publicPort, RELAY_CONTROL_PATH, {
        challenge: hello.challenge, session: nextSession, port: internalPort, build, pid: process.pid,
        proof: relayProof(secret, 'attach', hello.challenge, internalPort, nextSession),
      })
      // 先认下新会话再发登记：接线员可能一登记就把挂起的请求转过来。
      registration = { session: nextSession, secret }
      const reply = await response.catch(() => undefined)
      if (reply?.statusCode !== 200 || stopped) { reply?.resume(); request.destroy(); return false }
      channel = request
      // 等接线员告知本进程是在服务还是待命，登记才算完成，调用方此后读到的状态就是真实状态。
      let settled!: (attached: boolean) => void
      const ready = new Promise<boolean>(resolve => { settled = resolve })
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
      onState = () => { onState = undefined; settled(true) }
      reply.on('error', () => undefined)
      request.on('error', () => undefined)
      reply.once('close', () => {
        settled(false)
        if (channel !== request) return
        channel = undefined
        if (stopped) return
        setState('connecting', { reason: 'channel_closed' })
        void maintain()
      })
      return ready
    }

    /** 读凭据失败（存储解不开）时本轮作罢稍后重试，不生成新凭据去覆盖。 */
    const readSecret = (): string | undefined => {
      try { return options.secret() } catch (error) {
        logger.warn('读取接线员凭据失败，稍后重试', { event: 'mcp.relay.secret_unavailable', error })
        return undefined
      }
    }
    const occupant = (probe: RelayProbe): McpConnectionIssue =>
      probe.kind === 'other_relay' ? 'other_relay' : probe.kind === 'other_instance' ? 'other_instance' : 'port_in_use'

    /** 一轮接线：登记成功返回 attached；端口空着且不再拉起返回 absent；其余返回暂时不能服务的原因，稍后重试。 */
    const settle = (startup: boolean) => exclusive(async (): Promise<'attached' | 'absent' | McpConnectionIssue> => {
      if (stopped) return 'connecting'
      const current = readSecret()
      if (!current) return 'connecting'
      secret = current
      let found = await probeRelay(publicPort, secret)
      if (launch && startup && found.kind === 'relay' && found.hello.build !== build && (found.hello.backends === 0 || found.hello.protocol < RELAY_PROTOCOL)) {
        // 版本替换只在本进程启动时做：重连时也替换的话，两个不同版本的痕迹会互相把对方的接线员换掉。
        const previous = found.hello
        if (await retireRelay(publicPort, secret, previous, 'replace') === 202) {
          logger.info('已让旧版本接线员退出，换用当前版本', { event: 'mcp.relay.replaced', context: { from: previous.build, to: build, pid: previous.pid } })
          found = await probeUntil(publicPort, secret, next => !(next.kind === 'relay' && next.hello.instance === previous.instance), 10_000)
        }
      }
      if (found.kind === 'absent' && launch && !stopped) {
        // 只用和存储一致的凭据拉起：另一个实例刚写入了不同凭据时，本轮作罢，下一轮用存储里的值。
        if (readSecret() !== secret) return 'connecting'
        try {
          await launch(options.script, publicPort, secret)
          logger.info('已拉起接线员', { event: 'mcp.relay.spawned', context: { build, port: publicPort } })
          found = await probeUntil(publicPort, secret, next => next.kind !== 'absent', 10_000)
        } catch (error) {
          logger.warn('拉起接线员失败', { event: 'mcp.relay.spawn_failed', error })
        }
      }
      if (found.kind === 'absent') return 'absent'
      if (found.kind !== 'relay') return occupant(found)
      if (found.hello.protocol !== RELAY_PROTOCOL) return 'relay_version'
      if (stopped) return 'connecting'
      if (!await attach(found.hello)) return 'connecting'
      // 登记期间存储里的凭据被另一个实例换掉了：让这个按旧凭据运行的接线员退出，下一轮按新凭据重来。
      const latest = readSecret()
      if (latest && latest !== secret) {
        logger.warn('接线员凭据已被另一个痕迹更新，换用新凭据重新接线', { event: 'mcp.relay.secret_changed' })
        const hello = await probeRelay(publicPort, secret)
        if (hello.kind === 'relay') await retireRelay(publicPort, secret, hello.hello, 'release', registration?.session)
        channel?.destroy()
        return 'connecting'
      }
      return 'attached'
    })

    /** 只在确认端口空着时直接监听；失败（接线员恰好起来了）就回到经接线员的模式继续重试。 */
    const tryDirect = () => exclusive(async (): Promise<boolean> => {
      if (stopped) return false
      await close(http)
      acceptVia(false)
      try {
        await listen(http, publicPort)
        mode = 'direct'
        registration = undefined
        setState('direct')
        logger.warn('接线员不可用，改由痕迹直接监听', { event: 'mcp.relay.direct', context: { port: publicPort } })
        return true
      } catch (error) {
        logger.warn('直接监听对外端口失败，继续尝试接线员', { event: 'mcp.relay.direct_failed', context: { port: publicPort }, error })
        await listenRelayed()
        return false
      }
    })

    const round = async (startup: boolean): Promise<void> => {
      const outcome = await settle(startup)
      if (outcome === 'attached') return
      if (outcome === 'absent' && await tryDirect()) return
      if (!stopped) setState(outcome === 'absent' ? 'connecting' : outcome, { reason: outcome })
    }

    /**
     * 直到登记上或改为直接监听才停。循环条件每轮重看控制连接：登记成功后连接随即又断开时，
     * 关闭回调里的 maintain 会因本循环仍在运行而直接返回，这里接着重试，不会停在“正在接通”。
     */
    const maintain = async () => {
      if (maintaining) return
      maintaining = true
      try {
        for (let delay = 500; !stopped && mode === 'relay' && !channel; delay = Math.min(delay * 2, 5_000)) {
          await sleep(delay)
          if (!stopped) await round(false)
        }
      } finally { maintaining = false }
    }

    try { build = relayBuildOf(options.script) } catch (error) {
      // 找不到接线员程序（只会出现在构建不完整时）：仍按同样的规则登记或直接监听，只是不拉起。
      logger.warn('找不到接线员程序，不拉起接线员', { event: 'mcp.relay.script_missing', error })
      launch = undefined
    }
    await listenRelayed()
    await round(true)
    void maintain()

    return {
      state: () => state,
      stop: async ({ release = false } = {}) => {
        stopped = true
        channel?.destroy()
        channel = undefined
        await exclusive(async () => {
          if (!release || mode !== 'relay') return
          const found = await probeRelay(publicPort, secret)
          if (found.kind !== 'relay') return
          const status = await retireRelay(publicPort, secret, found.hello, 'release', registration?.session)
          if (status === 202) {
            logger.info('已关闭接线员', { event: 'mcp.relay.released', context: { port: publicPort } })
            await probeUntil(publicPort, secret, next => next.kind !== 'relay', 5_000)
          } else {
            logger.info('接线员仍有别的痕迹在用，保留', { event: 'mcp.relay.release_skipped', context: { port: publicPort, status } })
          }
        })
      },
    }
  }
}
