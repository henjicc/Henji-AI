import { expect, it, vi, beforeEach } from 'vitest'
const mock = vi.hoisted(() => ({ access: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(), rename: vi.fn(), rm: vi.fn(), video: vi.fn(), image: vi.fn() }))
vi.mock('node:fs/promises', () => ({ default: { access: mock.access, mkdir: mock.mkdir, writeFile: mock.writeFile, rename: mock.rename, rm: mock.rm } }))
vi.mock('../db', () => ({ getHenjiDataDir: () => 'D:/test-profile' }))
vi.mock('../video/ops', () => ({ generateVideoThumbnailBytes: mock.video }))
vi.mock('../image/ops', () => ({ generateImageThumbnailBytes: mock.image }))
import { ensureAssetThumbnail } from './thumbnailService'
beforeEach(() => { vi.resetAllMocks(); mock.access.mockRejectedValue(new Error('missing')) })

it('相同原素材并发只生成一张；取消一个使用者不取消仍可见使用者', async () => {
  let resolve!: (value: Buffer) => void; let signal!: AbortSignal
  mock.video.mockImplementation((_path, _size, incoming) => { signal = incoming; return new Promise(done => { resolve = done }) })
  const cancel = new AbortController()
  const first = ensureAssetThumbnail('D:/original.mp4', 'video', 42, cancel.signal).catch(error => error)
  const second = ensureAssetThumbnail('D:/original.mp4', 'video', 42)
  await vi.waitFor(() => expect(mock.video).toHaveBeenCalledTimes(1))
  cancel.abort(new Error('第一项不可见'))
  expect(await first).toBe(cancel.signal.reason); expect(signal.aborted).toBe(false)
  resolve(Buffer.from('thumbnail'))
  expect(await second).toMatch(/\.webp$/)
  expect(mock.writeFile).toHaveBeenCalledTimes(1); expect(mock.rename).toHaveBeenCalledTimes(1)
  expect(mock.rm).toHaveBeenCalledWith(expect.stringContaining('.tmp'), { force: true })
})

it('全部使用者取消就终止解码，不落盘；后续可重新生成', async () => {
  mock.video.mockImplementation((_path, _size, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })))
  const cancel = new AbortController()
  const first = ensureAssetThumbnail('D:/cancel.mp4', 'video', 42, cancel.signal).catch(error => error)
  await vi.waitFor(() => expect(mock.video).toHaveBeenCalledTimes(1))
  cancel.abort(new Error('关闭面板'))
  expect(await first).toBe(cancel.signal.reason)
  expect(mock.video.mock.calls[0][2].aborted).toBe(true); expect(mock.writeFile).not.toHaveBeenCalled()
  mock.video.mockResolvedValue(Buffer.from('restored'))
  expect(await ensureAssetThumbnail('D:/cancel.mp4', 'video', 42)).toMatch(/\.webp$/)
})

it('已有缩略图直接命中缓存；音频不触发图像或视频解码', async () => {
  mock.access.mockResolvedValue(undefined)
  expect(await ensureAssetThumbnail('D:/cached.mp4', 'video', 42)).toMatch(/\.webp$/)
  expect(await ensureAssetThumbnail('D:/audio.wav', 'audio', 42)).toBeNull()
  expect(mock.video).not.toHaveBeenCalled(); expect(mock.image).not.toHaveBeenCalled(); expect(mock.writeFile).not.toHaveBeenCalled()
})
