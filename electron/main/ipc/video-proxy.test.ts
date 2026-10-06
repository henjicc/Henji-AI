import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VIDEO_PROXY_CHANNELS } from '../../../src/platform/contracts/videoProxy'

type Handler = (raw: unknown, event: IpcMainInvokeEvent) => Promise<unknown>
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), trusted: vi.fn(), allowed: vi.fn(), realpath: vi.fn(), lookup: vi.fn(), create: vi.fn() }))
vi.mock('electron', () => ({ app: { once() {} } }))
vi.mock('./application-control', () => ({ assertTrustedApplicationSender: mocks.trusted }))
vi.mock('./registry', () => ({ registerIpcHandler: (channel: string, parse: (raw: unknown) => unknown, handler: Handler, guard: (event: IpcMainInvokeEvent) => void) => { mocks.handlers.set(channel, async (raw, event) => { guard(event); return handler(parse(raw), event) }) } }))
vi.mock('node:fs/promises', () => ({ default: { realpath: mocks.realpath } }))
vi.mock('../protocol', () => ({ isPathWithinAllowedMediaRoots: mocks.allowed, allowMediaRoot: vi.fn() }))
vi.mock('../services/image/source', () => ({ normalizeLocalSource: (source: string) => source }))
vi.mock('../services/media/content-disk-cache', () => ({ createContentDiskCache: () => ({}) }))
vi.mock('../services/appPaths', () => ({ getProgramDataDir: () => path.resolve('cache') }))
vi.mock('../services/video/proxy', () => ({ VideoProxyService: class { create = mocks.create; lookup = mocks.lookup } }))
vi.mock('../services/logging', () => ({ createMainLogger: () => ({ info() {}, warn() {}, error() {} }) }))
import { registerVideoProxyHandlers } from './video-proxy'

const senders: EventEmitter[] = []
let senderId = 700
function sender(): IpcMainInvokeEvent {
  const emitter = Object.assign(new EventEmitter(), { id: ++senderId, isDestroyed: () => false, send: vi.fn() })
  senders.push(emitter); return { sender: emitter } as unknown as IpcMainInvokeEvent
}
const source = path.resolve('media', 'scenes.mp4')
const request = { requestId: 'scene', source, preset: '720p' }
const invoke = (channel: keyof typeof VIDEO_PROXY_CHANNELS, raw: unknown, event: IpcMainInvokeEvent) => mocks.handlers.get(VIDEO_PROXY_CHANNELS[channel])!(raw, event)
beforeEach(() => {
  vi.resetAllMocks(); mocks.allowed.mockReturnValue(true); mocks.realpath.mockResolvedValue(source)
  mocks.lookup.mockResolvedValue(null); mocks.create.mockResolvedValue({ path: source, preset: '720p' })
  registerVideoProxyHandlers()
})
afterEach(() => { for (const emitter of senders.splice(0)) emitter.emit('destroyed') })

it('可信窗口、严格参数和真实文件授权在后台调用前检查；验证使用同一授权', async () => {
  const event = sender()
  await expect(invoke('create', { ...request, extra: true }, event)).rejects.toThrow()
  await expect(invoke('create', { ...request, preset: '4K' }, event)).rejects.toThrow()
  mocks.trusted.mockImplementationOnce(() => { throw new Error('untrusted') })
  await expect(invoke('create', request, event)).rejects.toThrow('untrusted')
  mocks.allowed.mockReturnValueOnce(false)
  await expect(invoke('create', request, event)).rejects.toThrow('权限')
  mocks.allowed.mockReturnValueOnce(true).mockReturnValueOnce(false)
  await expect(invoke('create', request, event)).rejects.toThrow('实际位置')
  expect(mocks.create).not.toHaveBeenCalled()
  await expect(invoke('lookup', { source, preset: '720p' }, event)).resolves.toBeNull()
  mocks.allowed.mockReturnValueOnce(false)
  await expect(invoke('lookup', { source, preset: '720p' }, event)).rejects.toThrow('权限')
})

it('取消仅归原窗口，重复与每窗口上限拒绝；主导航取消任务，进度仅回原窗口', async () => {
  const event = sender(); const other = sender(); const signals: AbortSignal[] = []
  mocks.create.mockImplementation((_request, signal: AbortSignal, progress: (value: number) => void) => {
    signals.push(signal); progress(.5)
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const first = invoke('create', request, event).catch(error => error)
  await vi.waitFor(() => expect(signals).toHaveLength(1))
  expect(event.sender.send).toHaveBeenCalledWith(VIDEO_PROXY_CHANNELS.progress, { requestId: 'scene', progress: .5 })
  await invoke('cancel', 'scene', other); expect(signals[0].aborted).toBe(false)
  await expect(invoke('create', request, event)).rejects.toThrow('正在进行')
  const second = invoke('create', { ...request, requestId: 'second' }, event).catch(error => error)
  await vi.waitFor(() => expect(signals).toHaveLength(2))
  await expect(invoke('create', { ...request, requestId: 'third' }, event)).rejects.toThrow('正在进行')
  await invoke('cancel', 'scene', event); expect(await first).toBeInstanceOf(Error)
  event.sender.emit('did-start-navigation', {}, '', false, false); expect(signals[1].aborted).toBe(false)
  event.sender.emit('did-start-navigation', {}, '', false, true); expect(await second).toBeInstanceOf(Error)
  mocks.create.mockResolvedValue({ path: source, preset: '720p' })
  await expect(invoke('create', request, event)).resolves.toMatchObject({ preset: '720p' })
})
