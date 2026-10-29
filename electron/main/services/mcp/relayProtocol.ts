import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Socket } from 'node:net'

/**
 * 接线员与痕迹之间的控制协议。接线员长期占住对外 MCP 端口，痕迹重启期间替外部客户端挂起请求。
 *
 * 凭据只用于 HMAC 证明，从不出现在线上：
 * - `relay`：接线员回应问候时证明自己知道凭据，防止痕迹把对外端口上的别的程序当成接线员；
 * - `attach` / `retire`：后端登记、请旧接线员退出时证明身份，挑战值一次有效；
 * - `connect`：接线员每次连到后端内部端口都先要后端证明，后端退出后有别的程序抢占同一端口也拿不到请求。
 * 各用途前缀不同，任何一方回答的证明都不能挪作他用。
 */
export const RELAY_PROTOCOL = 1
export const RELAY_CONTROL_PATH = '/henji-relay'
export const RELAY_RETIRE_PATH = '/henji-relay/retire'
export const RELAY_CHALLENGE_HEADER = 'x-henji-relay-challenge'
/** 只在拉起接线员时经环境变量传入，接线员读取后立即从自身环境删除。 */
export const RELAY_PORT_ENV = 'HENJI_MCP_RELAY_PORT'
export const RELAY_SECRET_ENV = 'HENJI_MCP_RELAY_SECRET'

type RelayProofPurpose = 'relay' | 'attach' | 'retire' | 'connect'

export interface RelayHello {
  protocol: number
  build: string
  pid: number
  /** 当前登记的后端数；新版本只在没有后端时替换旧接线员，避免打断另一个正在服务的痕迹。 */
  backends: number
  challenge: string
  proof: string
}

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
export function readHandshakeLine(socket: Socket, timeoutMs = 3_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = ''
    const cleanup = () => {
      clearTimeout(timer)
      socket.removeListener('readable', onReadable)
      socket.removeListener('error', fail)
      socket.removeListener('close', fail)
    }
    const fail = () => { cleanup(); socket.destroy(); reject(new Error('握手失败')) }
    const onReadable = () => {
      let chunk: Buffer | null
      while ((chunk = socket.read() as Buffer | null) !== null) received += chunk.toString('latin1')
      const end = received.indexOf('\n')
      if (end < 0) { if (received.length > 256) fail(); return }
      if (end !== received.length - 1) return fail()
      cleanup()
      resolve(received.slice(0, end))
    }
    const timer = setTimeout(fail, timeoutMs)
    socket.on('readable', onReadable)
    socket.once('error', fail)
    socket.once('close', fail)
  })
}

/** 接线员代码的身份：同一份构建产物得到同一个值，代码变了就换掉旧接线员。 */
export function relayBuildOf(script: string): string {
  return createHash('sha256').update(readFileSync(script)).digest('hex').slice(0, 16)
}
