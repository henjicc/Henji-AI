import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SCENE_DETECTION_CHANNELS } from '../../../src/platform/contracts/sceneDetection'
import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS } from '../../../src/core/videoEdit/time'

type Handler = (raw: unknown, event: IpcMainInvokeEvent) => Promise<unknown>
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), trusted: vi.fn(), allowed: vi.fn(), realpath: vi.fn(), identity: vi.fn(), detect: vi.fn() }))
vi.mock('electron', () => ({ app: { once() {} } }))
vi.mock('./application-control', () => ({ assertTrustedApplicationSender: mocks.trusted }))
vi.mock('./registry', () => ({ registerIpcHandler: (channel: string, parse: (raw: unknown) => unknown, handler: Handler, guard: (event: IpcMainInvokeEvent) => void) => { mocks.handlers.set(channel, async (raw, event) => { guard(event); return handler(parse(raw), event) }) } }))
vi.mock('node:fs/promises', () => ({ default: { realpath: mocks.realpath } }))
vi.mock('../protocol', () => ({ isPathWithinAllowedMediaRoots: mocks.allowed }))
vi.mock('../services/image/source', () => ({ normalizeLocalSource: (source: string) => source }))
vi.mock('../services/media/content-disk-cache', () => ({ createContentDiskCache: () => ({}) }))
vi.mock('../services/media/content-identity', () => ({ identifyMediaContent: mocks.identity }))
vi.mock('../services/appPaths', () => ({ getProgramDataDir: () => path.resolve('cache') }))
vi.mock('../services/video/scene-detection', () => ({ SceneDetectionService: class { detect = mocks.detect } }))
vi.mock('../services/logging', () => ({ createMainLogger: () => ({ info() {}, warn() {}, error() {} }) }))
import { registerSceneDetectionHandlers } from './scene-detection'

const senders: EventEmitter[] = []
let senderId = 700
function sender(): IpcMainInvokeEvent {
  const emitter = Object.assign(new EventEmitter(), { id: ++senderId, isDestroyed: () => false, send: vi.fn() })
  senders.push(emitter); return { sender: emitter } as unknown as IpcMainInvokeEvent
}
const source = path.resolve('media', 'scenes.mp4')
const request = { requestId: 'scene', source, startSeconds: 1, endSeconds: 5, sensitivity: 50 }
const invoke = (channel: keyof typeof SCENE_DETECTION_CHANNELS, raw: unknown, event: IpcMainInvokeEvent) => mocks.handlers.get(SCENE_DETECTION_CHANNELS[channel])!(raw, event)
beforeEach(() => {
  vi.resetAllMocks(); mocks.allowed.mockReturnValue(true); mocks.realpath.mockResolvedValue(source)
  mocks.identity.mockResolvedValue({ identity: 'a'.repeat(64) }); mocks.detect.mockResolvedValue({ cutsSeconds: [2], contentIdentity: 'a'.repeat(64) })
  registerSceneDetectionHandlers()
})
afterEach(() => { for (const emitter of senders.splice(0)) emitter.emit('destroyed') })

it('可信窗口、严格参数和真实文件授权在后台调用前检查；验证使用同一授权', async () => {
  const event = sender()
  await expect(invoke('detect', { ...request, extra: true }, event)).rejects.toThrow()
  for (const invalid of [{ endSeconds: VIDEO_EDIT_MAX_SEQUENCE_SECONDS + 1 }, { endSeconds: request.startSeconds }, { sensitivity: 101 }, { endSeconds: Infinity }]) {
    await expect(invoke('detect', { ...request, ...invalid }, event)).rejects.toThrow()
  }
  mocks.trusted.mockImplementationOnce(() => { throw new Error('untrusted') })
  await expect(invoke('detect', request, event)).rejects.toThrow('untrusted')
  mocks.allowed.mockReturnValueOnce(false)
  await expect(invoke('detect', request, event)).rejects.toThrow('权限')
  mocks.allowed.mockReturnValueOnce(true).mockReturnValueOnce(false)
  await expect(invoke('detect', request, event)).rejects.toThrow('实际位置')
  expect(mocks.detect).not.toHaveBeenCalled()
  for (const endSeconds of [1802, VIDEO_EDIT_MAX_SEQUENCE_SECONDS]) {
    await expect(invoke('detect', { ...request, endSeconds }, event)).resolves.toMatchObject({ cutsSeconds: [2] })
  }
  await expect(invoke('validate', { source, contentIdentity: 'a'.repeat(64) }, event)).resolves.toBe(true)
  await expect(invoke('validate', { source, contentIdentity: 'b'.repeat(64) }, event)).resolves.toBe(false)
  mocks.allowed.mockReturnValueOnce(false)
  await expect(invoke('validate', { source, contentIdentity: 'a'.repeat(64) }, event)).rejects.toThrow('权限')
})

it('取消仅归原窗口，重复与每窗口上限拒绝；主导航取消任务，进度仅回原窗口', async () => {
  const event = sender(); const other = sender(); const signals: AbortSignal[] = []
  mocks.detect.mockImplementation((_request, signal: AbortSignal, progress: (value: number) => void) => {
    signals.push(signal); progress(.5)
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const first = invoke('detect', request, event).catch(error => error)
  await vi.waitFor(() => expect(signals).toHaveLength(1))
  expect(event.sender.send).toHaveBeenCalledWith(SCENE_DETECTION_CHANNELS.progress, { requestId: 'scene', progress: .5 })
  await invoke('cancel', 'scene', other); expect(signals[0].aborted).toBe(false)
  await expect(invoke('detect', request, event)).rejects.toThrow('正在进行')
  const second = invoke('detect', { ...request, requestId: 'second' }, event).catch(error => error)
  await vi.waitFor(() => expect(signals).toHaveLength(2))
  await expect(invoke('detect', { ...request, requestId: 'third' }, event)).rejects.toThrow('正在进行')
  await invoke('cancel', 'scene', event); expect(await first).toBeInstanceOf(Error)
  event.sender.emit('did-start-navigation', {}, '', false, false); expect(signals[1].aborted).toBe(false)
  event.sender.emit('did-start-navigation', {}, '', false, true); expect(await second).toBeInstanceOf(Error)
  mocks.detect.mockResolvedValue({ cutsSeconds: [], contentIdentity: 'a'.repeat(64) })
  await expect(invoke('detect', request, event)).resolves.toMatchObject({ cutsSeconds: [] })
})
