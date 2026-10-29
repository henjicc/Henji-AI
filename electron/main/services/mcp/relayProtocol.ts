import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { Socket } from 'node:net'

/**
 * 接线员与痕迹之间的控制协议。接线员长期占住对外 MCP 端口，痕迹重启期间替外部客户端挂起请求。
 *
 * 凭据只用于 HMAC 证明，从不出现在线上；各用途前缀不同，任何一方回答的证明都不能挪作他用：
 * - `relay`：接线员回应问候时证明自己知道凭据，痕迹据此确认对外端口上的是自己的接线员；
 * - `attach` / `retire`：后端登记、请接线员退出时证明身份，挑战值由接线员签发且只能用一次；
 * - `dial` / `connect`：每次转发前，接线员连上后端内部入口先出示 `dial` 证明，后端核对后才回 `connect` 证明，
 *   接线员核对通过才发带令牌的请求。两者都绑定登记时后端自选的会话值，只在本次登记内有效：
 *   别的程序既拿不到后端的证明，也无法在后端退出后抢占同一端口骗到请求。
 */
export const RELAY_PROTOCOL = 1
export const RELAY_CONTROL_PATH = '/henji-relay'
export const RELAY_RETIRE_PATH = '/henji-relay/retire'
export const RELAY_CHALLENGE_HEADER = 'x-henji-relay-challenge'
/** 只在拉起接线员时经环境变量传入，接线员读取后立即从自身环境删除。 */
export const RELAY_PORT_ENV = 'HENJI_MCP_RELAY_PORT'
export const RELAY_SECRET_ENV = 'HENJI_MCP_RELAY_SECRET'

type RelayProofPurpose = 'relay' | 'attach' | 'retire' | 'dial' | 'connect'

export interface RelayHello {
  protocol: number
  build: string
  pid: number
  /** 每个接线员进程启动时随机生成，用来分辨“换上的新接线员”与“还没退出的旧接线员”。 */
  instance: string
  /** 当前登记的后端数；新版本只在没有后端时替换旧接线员，避免打断另一个正在服务的痕迹。 */
  backends: number
  challenge: string
  proof: string
}

/**
 * 请接线员退出：`replace` 是换成新版本，挂起的请求转交给新接线员；`release` 是关闭外部连接，挂起的请求立即回 503。
 * `session` 是请求方自己的登记（没有就留空），不计入“还有别的后端在用”的判断。
 */
export type RelayRetireMode = 'replace' | 'release'

type RelayLogLevel = 'info' | 'warn' | 'error'
/** `at` 是事件发生的时间：没有后端时日志先积压在接线员里，补交时不能按送达时间记。 */
export interface RelayLogEntry { level: RelayLogLevel; event: string; message: string; context?: Record<string, unknown>; at: string }
/** 控制连接上逐行发送的 JSON：当前后端是否在服务、接线员自身的日志。 */
export type RelayControlMessage = { type: 'state'; active: boolean } | ({ type: 'log' } & RelayLogEntry)

const CHALLENGE_PATTERN = /^[0-9a-f]{32}$/

export function createRelayChallenge(): string { return randomBytes(16).toString('hex') }
export function isRelayChallenge(value: unknown): value is string { return typeof value === 'string' && CHALLENGE_PATTERN.test(value) }

export function relayProof(secret: string, purpose: RelayProofPurpose, ...parts: Array<string | number>): string {
  return createHmac('sha256', secret).update([purpose, ...parts].join(':')).digest('hex')
}

export function relayProofMatches(expected: string, actual: unknown): boolean {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
}

/**
 * 读取新连接上的一行握手内容。握手双方都等对方答完才发 HTTP，所以换行后不应再有数据；
 * 用 readable 读取而不是 data，移除监听后连接回到未定流动状态，HTTP 解析接手时不丢字节。
 */
export function readHandshakeLine(socket: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = ''
    const cleanup = () => {
      clearTimeout(timer)
      socket.removeListener('readable', onReadable)
      socket.removeListener('error', fail)
      socket.removeListener('close', fail)
    }
    const fail = (error?: unknown) => {
      cleanup()
      socket.destroy()
      reject(error instanceof Error ? error : new Error('握手失败'))
    }
    const onReadable = () => {
      let chunk: Buffer | null
      while ((chunk = socket.read() as Buffer | null) !== null) received += chunk.toString('latin1')
      const end = received.indexOf('\n')
      if (end < 0) { if (received.length > 256) fail(); return }
      if (end !== received.length - 1) return fail()
      cleanup()
      resolve(received.slice(0, end))
    }
    const timer = setTimeout(() => fail(Object.assign(new Error('握手超时'), { code: 'ETIMEDOUT' })), timeoutMs)
    socket.on('readable', onReadable)
    socket.once('error', fail)
    socket.once('close', () => fail())
  })
}

export type RelayProbe = { kind: 'absent' } | { kind: 'foreign' } | { kind: 'relay'; hello: RelayHello }

/**
 * 看对外端口上是谁：没人监听（absent）、是知道同一凭据的接线员（relay），还是别的程序或凭据不同的接线员（foreign）。
 * 回应慢也算 foreign，调用方稍后再看，不据此改为直接监听。
 */
export function probeRelay(port: number, secret: string): Promise<RelayProbe> {
  return new Promise(resolve => {
    const challenge = createRelayChallenge()
    const request = httpRequest({ host: '127.0.0.1', port, path: RELAY_CONTROL_PATH, method: 'GET', headers: { [RELAY_CHALLENGE_HEADER]: challenge }, timeout: 5_000 }, response => {
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

/** 接线员代码的身份：同一份构建产物得到同一个值，代码变了就换掉旧接线员。 */
export function relayBuildOf(script: string): string {
  return createHash('sha256').update(readFileSync(script)).digest('hex').slice(0, 16)
}
