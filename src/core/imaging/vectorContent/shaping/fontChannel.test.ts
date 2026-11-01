import fs from 'node:fs'
import { convert } from 'fontverter'
import { MessageChannel } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { serveFontChannel, TextFontChannel, type FontPort, type FontSnapshot } from './fontChannel'

const cleanup: Array<() => void> = []
afterEach(() => cleanup.splice(0).reverse().forEach(close => close()))
const connect = (capture: () => Promise<FontSnapshot>) => {
  const ports = new MessageChannel(), failed = vi.fn()
  const stop = serveFontChannel(ports.port1 as unknown as FontPort, capture, failed)
  cleanup.push(stop)
  const channel = new TextFontChannel(ports.port2 as unknown as FontPort)
  cleanup.push(() => channel.close())
  return { channel, failed, stop }
}
it('渲染队列等待资源时独立端口仍返回；传输转移专用字节且不在宿主持有副本，释放拒收迟到字体', async () => {
  const original = await convert(fs.readFileSync('node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'), 'sfnt'), bytes = Uint8Array.from(original).buffer, close = vi.fn()
  const read = vi.fn(async () => ({ bytes: bytes.byteLength ? bytes : Uint8Array.from(original).buffer, variations: { wght: 550 } }))
  const { channel } = connect(async () => ({ platform: 'win32', revision: 4, read, close }))
  const lease = await channel.open()
  // 模拟渲染队首直接等待，不为回复让出队列中的下一项。
  const queue = Promise.resolve().then(() => lease.fonts.prepare())
  await queue
  expect(bytes.byteLength).toBe(0)
  expect(lease.fonts.chain().candidates[0].font?.variations).toEqual({ wght: 550 })
  const count = read.mock.calls.length
  await lease.fonts.prepare()
  expect(read).toHaveBeenCalledTimes(count)
  let finish!: (value: { bytes: ArrayBuffer; variations: { wght: number } }) => void
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = lease.fonts.prepare({ faces: [{ family: 'extra' }] })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  lease.release()
  await expect(pending).rejects.toThrow('释放')
  finish({ bytes, variations: { wght: 550 } })
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(() => lease.fonts.chain()).toThrow('关闭')
})
it('取消快照准备会释放迟到快照；另一租约仍可准备，关闭通道拒绝所有等待', async () => {
  let resolve!: (snapshot: FontSnapshot) => void
  const close = vi.fn(), read = vi.fn(async () => ({ bytes: new ArrayBuffer(2) }))
  const capture = vi.fn().mockImplementationOnce(() => new Promise<FontSnapshot>(done => { resolve = done })).mockImplementation(async () => ({ revision: 7, platform: 'win32', read, close }))
  const { channel } = connect(capture)
  const controller = new AbortController(), waiting = channel.open(controller.signal)
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  controller.abort(new Error('cancelled'))
  await expect(waiting).rejects.toThrow('cancelled')
  resolve({ revision: 6, platform: 'win32', read, close })
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  const lease = await channel.open()
  expect(lease.revision).toBe(7)
  const pending = lease.fonts.prepare()
  channel.close()
  await expect(pending).rejects.toThrow('释放')
  await expect(channel.open()).rejects.toThrow('关闭')
})

it('宿主先关闭端口时主动拒绝客户端等待，不依赖渲染队列或超时强杀', async () => {
  let resolve!: (snapshot: FontSnapshot) => void
  const close = vi.fn()
  const { channel, stop } = connect(() => new Promise(done => { resolve = done }))
  const pending = channel.open(), rejected = expect(pending).rejects.toThrow('释放')
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  stop()
  await rejected
  resolve({ platform: 'win32', revision: 1, read: async () => undefined, close })
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
})
