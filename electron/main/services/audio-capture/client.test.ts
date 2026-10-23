import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
import { AudioCaptureClient } from './client'

class Child extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough()
  received: string[] = []; dead = false
  constructor() {
    super()
    this.stdin.on('data', (bytes: Buffer) => {
      const request = JSON.parse(bytes.toString()) as { id: string; type: string }
      this.received.push(request.type)
      if (request.type === 'hang') return
      const result = request.type === 'hello' ? { protocol: 1 } : request.type === 'clock' ? { nativeMonoUs: 1000 } : { success: true }
      const json = Buffer.from(JSON.stringify({ id: request.id, ok: true, result, binaryBytes: 0 })); const header = Buffer.alloc(4); header.writeUInt32LE(json.length)
      this.stdout.write(Buffer.concat([header, json]))
    })
    this.stdin.on('finish', () => this.kill())
  }
  kill(): boolean { if (!this.dead) { this.dead = true; this.emit('exit', 1, null) } return true }
}
const clients: AudioCaptureClient[] = []
afterEach(() => { clients.forEach(c => c.dispose()); clients.length = 0; vi.useRealTimers() })
describe('录音进程生命周期', () => {
  it('并发调用只启动一次，崩溃后按需重启且不重放录音', async () => {
    const children: Child[] = []; mocks.spawn.mockImplementation(() => { const child = new Child(); children.push(child); return child })
    const crash = vi.fn(); const client = new AudioCaptureClient(() => 'native.exe', () => {}, crash); clients.push(client)
    await Promise.all([client.request('enumerate'), client.request('probe')]); expect(children).toHaveLength(1)
    await client.request('start'); children[0].stdin.emit('error', new Error('EPIPE')); children[0].kill(); expect(crash).toHaveBeenCalledTimes(1)
    await client.request('enumerate'); expect(children).toHaveLength(2); expect(children[1].received).not.toContain('start')
    client.dispose(); expect(crash).toHaveBeenCalledTimes(1)
  })
  it('超时中断进程并拒绝待定请求，关闭会话无悬挂 promise', async () => {
    vi.useFakeTimers(); const child = new Child(); mocks.spawn.mockReturnValue(child)
    const client = new AudioCaptureClient(() => 'native.exe', () => {}, () => {}); clients.push(client)
    await client.request('enumerate')
    const pending = client.request('hang'); const rejected = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(20_001); await rejected; expect(child.dead).toBe(true)
  })
})
