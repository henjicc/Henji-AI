import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
import { AudioCaptureClient } from './client'

class Child extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough()
  received: string[] = []; dead = false; hang = new Set(['hang']); hung = new Map<string, string>()
  /** 原生读到输入结束后正常收尾退出；设成 false 模拟它还在写完队列。 */
  exitOnEnd = true
  protocol = 4
  exitCode: number | null = null; signalCode: string | null = null
  constructor() {
    super()
    this.stdin.on('data', (bytes: Buffer) => {
      const request = JSON.parse(bytes.toString()) as { id: string; type: string }
      this.received.push(request.type)
      if (this.hang.has(request.type)) { this.hung.set(request.type, request.id); return }
      this.reply(request.id, request.type)
    })
    this.stdin.on('finish', () => { if (this.exitOnEnd) this.kill() })
  }
  reply(id: string, type: string): void {
    const result = type === 'hello' ? { protocol: this.protocol } : type === 'clock' ? { nativeMonoUs: 1000 } : { success: true }
    const json = Buffer.from(JSON.stringify({ id, ok: true, result, binaryBytes: 0 })); const header = Buffer.alloc(4); header.writeUInt32LE(json.length)
    this.stdout.write(Buffer.concat([header, json]))
  }
  answer(type: string): void { this.reply(this.hung.get(type)!, type) }
  kill(): boolean { if (!this.dead) { this.dead = true; this.exitCode = 1; this.emit('exit', 1, null) } return true }
}
const clients: AudioCaptureClient[] = []
afterEach(() => { clients.forEach(c => void c.dispose()); clients.length = 0; vi.useRealTimers() })
describe('录音进程生命周期', () => {
  it('并发调用只启动一次，崩溃后按需重启且不重放录音', async () => {
    const children: Child[] = []; mocks.spawn.mockImplementation(() => { const child = new Child(); children.push(child); return child })
    const crash = vi.fn(); const client = new AudioCaptureClient(() => 'native.exe', () => {}, crash); clients.push(client)
    await Promise.all([client.request('enumerate'), client.request('probe')]); expect(children).toHaveLength(1)
    await client.request('start'); children[0].stdin.emit('error', new Error('EPIPE')); children[0].kill(); expect(crash).toHaveBeenCalledTimes(1)
    await client.request('enumerate'); expect(children).toHaveLength(2); expect(children[1].received).not.toContain('start')
    void client.dispose(); expect(crash).toHaveBeenCalledTimes(1)
  })
  it('超时结束进程并拒绝待定请求，关闭会话无悬挂 promise', async () => {
    vi.useFakeTimers(); const child = new Child(); mocks.spawn.mockReturnValue(child)
    const client = new AudioCaptureClient(() => 'native.exe', () => {}, () => {}); clients.push(client)
    await client.request('enumerate')
    const pending = client.request('hang'); const rejected = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(20_001); await rejected; expect(child.dead).toBe(true)
  })
  it('录音中停止迟迟不应答：等足排空缓冲的时间；超时后立刻收拢状态，让原生写完再退，宽限过了才强杀', async () => {
    vi.useFakeTimers(); const child = new Child(); child.hang.add('stop'); child.exitOnEnd = false; mocks.spawn.mockReturnValue(child)
    const crash = vi.fn(); const client = new AudioCaptureClient(() => 'native.exe', () => {}, crash); clients.push(client)
    await client.request('start'); client.setActive(true)
    const pending = client.request('stop'); const rejected = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(60_000); expect(crash).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(31_000); await rejected
    // 不等进程退出：状态当场收拢，进程关掉输入后还在写队列。
    expect(crash).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_RESPONDING' }))
    expect(child.dead).toBe(false)
    let settled = false; void client.settled().then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(110_000); expect(settled).toBe(false); expect(child.dead).toBe(false)
    await vi.advanceTimersByTimeAsync(11_000); expect(child.dead).toBe(true); expect(settled).toBe(true)
    expect(crash).toHaveBeenCalledOnce()
  })
  it('主进程卡过、计时器明显晚到时再宽限几秒，晚到的应答照常收下', async () => {
    vi.useFakeTimers(); const child = new Child(); mocks.spawn.mockReturnValue(child)
    const client = new AudioCaptureClient(() => 'native.exe', () => {}, () => {}); clients.push(client)
    await client.request('enumerate')
    const pending = client.request('hang')
    await vi.advanceTimersByTimeAsync(1)
    expect(child.hung.has('hang')).toBe(true)
    // 主进程卡了 30 秒：计时器触发时墙上时间已经远超预定。
    const frozenUntil = Date.now() + 50_000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => frozenUntil)
    await vi.advanceTimersByTimeAsync(20_001)
    expect(child.dead).toBe(false)
    child.answer('hang')
    await expect(pending).resolves.toEqual({ success: true })
    now.mockRestore()
  })
  it('系统声段事件的原生时钟换算到主进程时钟：与画面、事件同一个时间轴', async () => {
    const child = new Child(); mocks.spawn.mockReturnValue(child)
    const events: Array<{ event: string; monoUs?: number }> = []
    const client = new AudioCaptureClient(() => 'native.exe', event => events.push(event as { event: string; monoUs?: number }), () => {}); clients.push(client)
    const before = Number(process.hrtime.bigint() / 1000n)
    await client.request('enumerate')
    const after = Number(process.hrtime.bigint() / 1000n)
    const json = Buffer.from(JSON.stringify({ event: 'segment', sessionId: 's', phase: 'open', segmentId: '6f1f0d2c-0d6b-4b7e-9a1b-4e1f7c2f3a10', file: '6f1f0d2c-0d6b-4b7e-9a1b-4e1f7c2f3a10.wav', firstFrame: 0, sampleRate: 48000, channels: 2, bitDepth: 16, nativeMonoUs: 5000, uncertaintyUs: 0, binaryBytes: 0 }))
    const header = Buffer.alloc(4); header.writeUInt32LE(json.length); child.stdout.write(Buffer.concat([header, json]))
    await vi.waitFor(() => expect(events).toHaveLength(1))
    // 替身原生时钟回答 1000：原生 5000 微秒就是校准时刻之后 4000 微秒。
    expect(events[0].monoUs).toBeGreaterThanOrEqual(before + 4000)
    expect(events[0].monoUs).toBeLessThanOrEqual(after + 4000)
  })
  it('原生程序协议版本不配套时握手就失败：报可操作的提示，不记崩溃、不触发失联回调，再试几次也不被“连续异常”盖掉', async () => {
    const crash = vi.fn()
    const client = new AudioCaptureClient(() => 'native.exe', () => {}, crash); clients.push(client)
    for (let attempt = 0; attempt < 4; attempt++) {
      const child = new Child(); child.protocol = 3; mocks.spawn.mockReturnValue(child)
      await expect(client.request('enumerate')).rejects.toMatchObject({ code: 'VERSION_MISMATCH', message: expect.stringContaining('录音组件版本与应用不一致') })
      expect(child.dead).toBe(true)
    }
    expect(crash).not.toHaveBeenCalled()
  })
})
