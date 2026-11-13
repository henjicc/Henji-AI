import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('../../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
import { ScreenCaptureClient, SCREEN_CAPTURE_PROTOCOL, type ScreenCaptureEvent } from './native-client'

/** 按协议回话的替身进程：一行一条指令；回 `u32 小端长度 + JSON`（不带 binaryBytes，与真实进程一样）。 */
class Child extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough()
  received: Array<{ id: string; type: string; protocol?: number; atUs?: number }> = []
  protocol = SCREEN_CAPTURE_PROTOCOL
  exitCode: number | null = null; signalCode: string | null = null
  constructor() {
    super()
    this.stdin.on('data', (bytes: Buffer) => {
      for (const line of bytes.toString().split('\n').filter(Boolean)) {
        const request = JSON.parse(line) as { id: string; type: string; protocol?: number }
        this.received.push(request)
        if (request.type === 'hello' && request.protocol !== this.protocol) this.write({ id: request.id, ok: false, error: { code: 'PROTOCOL_MISMATCH', message: '不配套', recoverable: false } })
        else this.write({ id: request.id, ok: true, result: request.type === 'hello' ? { protocol: this.protocol } : request.type === 'clock' ? { nativeMonoUs: 1000 } : {} })
      }
    })
    this.stdin.on('finish', () => this.kill())
  }
  write(message: object): void { const json = Buffer.from(JSON.stringify(message)), header = Buffer.alloc(4); header.writeUInt32LE(json.length); this.stdout.write(Buffer.concat([header, json])) }
  kill(): boolean { if (this.exitCode === null) { this.exitCode = 1; this.emit('exit', 1, null) } return true }
}
const clients: ScreenCaptureClient[] = []
afterEach(async () => { await Promise.all(clients.map(client => client.dispose())); clients.length = 0 })

it('握手带上协议号，按原生时钟校准；事件按会话号交给订阅者，时刻换算到主进程时钟；不认识的事件不断开进程', async () => {
  const child = new Child(); mocks.spawn.mockReturnValue(child)
  const client = new ScreenCaptureClient(() => 'capture.exe'); clients.push(client)
  const before = Number(process.hrtime.bigint() / 1000n)
  await client.request('sources')
  const after = Number(process.hrtime.bigint() / 1000n)
  expect(child.received[0]).toMatchObject({ type: 'hello', protocol: SCREEN_CAPTURE_PROTOCOL })
  // 替身时钟回答 1000：原生 5000 微秒就是校准时刻之后 4000 微秒。
  expect(client.toMainUs(5000)).toBeGreaterThanOrEqual(before + 4000 - 1)
  expect(client.toMainUs(5000)).toBeLessThanOrEqual(after + 4000 + 1)
  expect(Math.abs(client.toNativeUs(client.toMainUs(5000)) - 5000)).toBeLessThanOrEqual(1)
  const events: ScreenCaptureEvent[] = [], other: ScreenCaptureEvent[] = []
  client.subscribe('s', event => events.push(event), () => undefined)
  client.subscribe('t', event => other.push(event), () => undefined)
  child.write({ event: 'someFutureEvent', sessionId: 's' })
  child.write({ event: 'resumed', sessionId: 's', atUs: 7000, cell: 150, frame: 90 })
  await vi.waitFor(() => expect(events).toHaveLength(1))
  expect(events[0]).toMatchObject({ event: 'resumed', cell: 150, frame: 90 })
  expect(other).toEqual([])
  await expect(client.request('status', { sessionId: 's' })).resolves.toEqual({})
})

it('采集程序与应用不配套：握手就失败，报可操作的提示，不算失联', async () => {
  const lost = vi.fn()
  const client = new ScreenCaptureClient(() => 'capture.exe', lost); clients.push(client)
  const child = new Child(); child.protocol = SCREEN_CAPTURE_PROTOCOL + 1; mocks.spawn.mockReturnValue(child)
  await expect(client.request('prepare')).rejects.toMatchObject({ code: 'VERSION_MISMATCH', message: expect.stringContaining('build-screen-capture') })
  expect(child.exitCode).not.toBeNull()
  expect(lost).not.toHaveBeenCalled()
})

it('录制中进程退出：订阅者收到失联，下次请求重新启动', async () => {
  const children: Child[] = []; mocks.spawn.mockImplementation(() => { const child = new Child(); children.push(child); return child })
  const client = new ScreenCaptureClient(() => 'capture.exe'); clients.push(client)
  await client.request('sources')
  const lost = vi.fn()
  client.subscribe('s', () => undefined, lost)
  children[0].kill()
  expect(lost).toHaveBeenCalledWith(expect.objectContaining({ code: 'PROCESS_EXITED' }))
  await client.request('sources')
  expect(children).toHaveLength(2)
})
