import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, expect, it, vi } from 'vitest'
type Handler = (input: unknown, event: IpcMainInvokeEvent) => unknown
const mock = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), bytes: vi.fn(), cache: vi.fn(), allowRoot: vi.fn(), stat: vi.fn(), realpath: vi.fn(), allowed: vi.fn(), frame: vi.fn() }))
vi.mock('./registry', () => ({
  parseRecord: (value: unknown) => { if (!value || typeof value !== 'object') throw new Error('object'); return value },
  parseStringField: (value: Record<string, unknown>, field: string) => { if (typeof value[field] !== 'string' || !value[field]) throw new Error(field); return value[field] },
  registerIpcHandler: (id: string, parse: (value: unknown) => unknown, handler: Handler) => mock.handlers.set(id, (input, event) => handler(parse(input), event)),
}))
vi.mock('node:fs/promises', () => ({ default: { stat: mock.stat, realpath: mock.realpath } }))
vi.mock('../services/asset-library/thumbnailService', () => ({ ensureAssetThumbnail: mock.cache }))
vi.mock('../protocol', () => ({ allowMediaRoot: mock.allowRoot, isPathWithinAllowedMediaRoots: mock.allowed }))
vi.mock('../services/video/filmstrip', () => ({ filmstripService: () => ({ frame: mock.frame }) }))
vi.mock('../services/image/source', () => ({ normalizeLocalSource: (source: string) => source }))
vi.mock('../services/video/ops', () => ({ generateVideoThumbnailBytes: mock.bytes, compressVideoToFit: vi.fn(), generateVideoThumbnail: vi.fn(), readVideoInfo: vi.fn(), trimVideoSource: vi.fn() }))
vi.mock('../services/video/preview-cache', () => ({ clearLegacyVideoPreviewCache: vi.fn() }))
vi.mock('../services/video/frame-export', () => ({ appendVideoFrameExport: vi.fn(), cancelVideoFrameExport: vi.fn(), finishVideoFrameExport: vi.fn(), startVideoFrameExport: vi.fn() }))
import { registerVideoIpc } from './video'
function sender(id: number): { event: IpcMainInvokeEvent; destroy: () => void } {
  const value = Object.assign(new EventEmitter(), { id })
  return { event: { sender: value } as unknown as IpcMainInvokeEvent, destroy: () => { value.emit('destroyed') } }
}
function invoke(id: string, input: unknown, event: IpcMainInvokeEvent): Promise<unknown> { return Promise.resolve().then(() => mock.handlers.get(id)!(input, event)) }
beforeEach(() => { vi.resetAllMocks(); mock.handlers.clear(); registerVideoIpc(); mock.stat.mockResolvedValue({ mtimeMs: 42 }) })

it('视频缓存和原字节路径均可用；拒绝错类型或越界缩略图参数', async () => {
  const owner = sender(1)
  mock.cache.mockResolvedValue('D:/profile/Thumbnails/cached.webp'); mock.bytes.mockResolvedValue(Buffer.from('bytes'))
  try {
    expect(await invoke('video:generateThumbnailBytes', { source: 'D:/original.mp4', cache: true, requestId: 'cache' }, owner.event)).toEqual({ bytes: new Uint8Array(), cachePath: 'D:/profile/Thumbnails/cached.webp' })
    expect(mock.cache).toHaveBeenCalledWith('D:/original.mp4', 'video', 42, expect.any(AbortSignal)); expect(mock.allowRoot).toHaveBeenCalled()
    expect(await invoke('video:generateThumbnailBytes', { source: 'D:/original.mp4', maxSize: 200 }, owner.event)).toEqual({ bytes: Buffer.from('bytes') })
    for (const input of [{ cache: 'true' }, { requestId: null }, { maxSize: 4 }, { maxSize: 16.5 }]) await expect(invoke('video:generateThumbnailBytes', { source: 'D:/original.mp4', ...input }, owner.event)).rejects.toThrow()
  } finally { owner.destroy() }
})

it('取消限定调用窗口；窗口销毁取消其剩余请求，重复标识不覆盖原控制器', async () => {
  const owner = sender(2); const other = sender(3)
  const signals: AbortSignal[] = []
  mock.bytes.mockImplementation((_source, _size, signal: AbortSignal) => {
    signals.push(signal)
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const first = invoke('video:generateThumbnailBytes', { source: 'D:/original.mp4', requestId: 'same' }, owner.event).catch(error => error)
  await vi.waitFor(() => expect(signals).toHaveLength(1))
  await invoke('video:cancelThumbnail', { requestId: 'same' }, other.event)
  expect(signals[0].aborted).toBe(false)
  await expect(invoke('video:generateThumbnailBytes', { source: 'D:/original.mp4', requestId: 'same' }, owner.event)).rejects.toThrow('已在使用')
  await invoke('video:cancelThumbnail', { requestId: 'same' }, owner.event)
  expect(await first).toBeInstanceOf(Error); expect(signals[0].aborted).toBe(true)
  const second = invoke('video:generateThumbnailBytes', { source: 'D:/original.mp4', requestId: 'next' }, owner.event).catch(error => error)
  await vi.waitFor(() => expect(signals).toHaveLength(2))
  owner.destroy(); expect(await second).toBeInstanceOf(Error); expect(signals[1].aborted).toBe(true); other.destroy()
})

it('片段缩略帧：只接受已授权素材、合法时间与高度档，按实际路径取帧并授权缓存目录（2.4）', async () => {
  const owner = sender(4)
  // Absolute on the platform running the test (a drive path is not absolute on Linux CI).
  const at = (...parts: string[]): string => path.resolve(path.sep, ...parts)
  const clip = at('media', 'clip.mp4'); const link = at('media', 'link.mp4'); const outside = at('outside', 'clip.mp4')
  const cached = at('profile', 'HenjiCache', 'Filmstrip', 'frame.webp')
  mock.allowed.mockImplementation((value: string) => !value.includes('outside'))
  mock.realpath.mockImplementation(async (value: string) => value === link ? at('outside', 'real.mp4') : value)
  mock.frame.mockResolvedValue(cached)
  try {
    expect(await invoke('video:generateThumbnailBytes', { source: clip, frame: { timeUs: 1_500_000, height: 48 }, requestId: 'tile' }, owner.event)).toEqual({ bytes: new Uint8Array(), cachePath: cached })
    expect(mock.frame).toHaveBeenCalledWith({ source: clip, timeUs: 1_500_000, height: 48 }, expect.any(AbortSignal))
    expect(mock.allowRoot).toHaveBeenCalledWith(path.dirname(cached))
    await expect(invoke('video:generateThumbnailBytes', { source: outside, frame: { timeUs: 0, height: 48 } }, owner.event)).rejects.toThrow('读取权限')
    await expect(invoke('video:generateThumbnailBytes', { source: link, frame: { timeUs: 0, height: 48 } }, owner.event)).rejects.toThrow('实际路径')
    for (const frame of [{ timeUs: -1, height: 48 }, { timeUs: 1.5, height: 48 }, { timeUs: 0, height: 50 }, { timeUs: 0, height: 48, extra: 1 }, 'frame']) await expect(invoke('video:generateThumbnailBytes', { source: clip, frame }, owner.event)).rejects.toThrow()
    await expect(invoke('video:generateThumbnailBytes', { source: clip, cache: true, frame: { timeUs: 0, height: 48 } }, owner.event)).rejects.toThrow('cache')
    expect(mock.frame).toHaveBeenCalledTimes(1)
  } finally { owner.destroy() }
})
