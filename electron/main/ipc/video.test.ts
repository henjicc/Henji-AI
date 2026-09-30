import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, expect, it, vi } from 'vitest'
type Handler = (input: unknown, event: IpcMainInvokeEvent) => unknown
const mock = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), bytes: vi.fn(), cache: vi.fn(), allowRoot: vi.fn(), stat: vi.fn() }))
vi.mock('./registry', () => ({
  parseRecord: (value: unknown) => { if (!value || typeof value !== 'object') throw new Error('object'); return value },
  parseStringField: (value: Record<string, unknown>, field: string) => { if (typeof value[field] !== 'string' || !value[field]) throw new Error(field); return value[field] },
  registerIpcHandler: (id: string, parse: (value: unknown) => unknown, handler: Handler) => mock.handlers.set(id, (input, event) => handler(parse(input), event)),
}))
vi.mock('node:fs/promises', () => ({ default: { stat: mock.stat } }))
vi.mock('../services/asset-library/thumbnailService', () => ({ ensureAssetThumbnail: mock.cache }))
vi.mock('../protocol', () => ({ allowMediaRoot: mock.allowRoot }))
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
