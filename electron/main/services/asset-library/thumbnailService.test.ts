import { expect, it, vi, beforeEach } from 'vitest'
const mock = vi.hoisted(() => ({ stat: vi.fn(), access: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(), rename: vi.fn(), rm: vi.fn(), video: vi.fn(), image: vi.fn() }))
vi.mock('node:fs/promises', () => ({ default: { stat: mock.stat, access: mock.access, mkdir: mock.mkdir, writeFile: mock.writeFile, rename: mock.rename, rm: mock.rm } }))
vi.mock('../db', () => ({ getHenjiDataDir: () => 'D:/test-profile' }))
vi.mock('../video/ops', () => ({ generateVideoThumbnailBytes: mock.video }))
vi.mock('../image/ops', () => ({ generateImageThumbnailBytes: mock.image }))
import { ensureAssetThumbnail } from './thumbnailService'
function stat(size = 100, mtimeMs = 42, ino = 1, ctimeMs = mtimeMs) {
  return { size, mtimeMs, ctimeMs, dev: 1, ino, isFile: () => true }
}
beforeEach(() => { vi.resetAllMocks(); mock.access.mockRejectedValue(new Error('missing')); mock.stat.mockResolvedValue(stat()) })

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
  expect(await ensureAssetThumbnail('D:/source.henji-code', 'code', 42)).toBeNull()
  expect(mock.video).not.toHaveBeenCalled(); expect(mock.image).not.toHaveBeenCalled(); expect(mock.writeFile).not.toHaveBeenCalled()
})

it('相同mtime但大小变化生成独立缩略图，不命中旧目标', async () => {
  mock.video.mockResolvedValue(Buffer.from('thumbnail'))
  const original = await ensureAssetThumbnail('D:/resized.mp4', 'video', 42)
  mock.stat.mockResolvedValue(stat(300))
  const changed = await ensureAssetThumbnail('D:/resized.mp4', 'video', 42)
  expect(changed).not.toBe(original)
  expect(mock.video).toHaveBeenCalledTimes(2)
  expect(mock.rename.mock.calls.map(call => call[1])).toEqual([original, changed])
})

it('mtime和大小相同但文件替换或ctime变化不复用原目标', async () => {
  mock.access.mockResolvedValue(undefined)
  const original = await ensureAssetThumbnail('D:/replaced.mp4', 'video', 42)
  mock.stat.mockResolvedValue(stat(100, 42, 2, 43))
  const changed = await ensureAssetThumbnail('D:/replaced.mp4', 'video', 42)
  expect(changed).not.toBe(original)
  expect(mock.video).not.toHaveBeenCalled()
})

it('媒体类型属于缓存身份，图片与视频不共享缩略图目标', async () => {
  mock.access.mockResolvedValue(undefined)
  const image = await ensureAssetThumbnail('D:/same-media', 'image', 42)
  const video = await ensureAssetThumbnail('D:/same-media', 'video', 42)
  expect(image).not.toBe(video)
})

it('收到过期mtime或非文件时拒绝解码，保留真实文件身份', async () => {
  await expect(ensureAssetThumbnail('D:/updated.mp4', 'video', 41)).rejects.toThrow('重新检查')
  mock.stat.mockResolvedValue({ ...stat(), isFile: () => false })
  await expect(ensureAssetThumbnail('D:/directory', 'video', 42)).rejects.toThrow('不是文件')
  expect(mock.video).not.toHaveBeenCalled()
  expect(mock.writeFile).not.toHaveBeenCalled()
})

it('解码期间文件变化不写入以旧内容身份命名的缓存', async () => {
  let complete!: (value: Buffer) => void
  mock.video.mockImplementation(() => new Promise<Buffer>(resolve => { complete = resolve }))
  const request = ensureAssetThumbnail('D:/changing.mp4', 'video', 42)
  const rejected = expect(request).rejects.toThrow('发生变化')
  await vi.waitFor(() => expect(mock.video).toHaveBeenCalledTimes(1))
  mock.stat.mockResolvedValue(stat(300, 42, 2, 43))
  complete(Buffer.from('old-picture'))
  await rejected
  expect(mock.writeFile).not.toHaveBeenCalled()
  expect(mock.rename).not.toHaveBeenCalled()
})

it('缓存access期间文件变化不能返回旧目标为有效命中', async () => {
  let complete!: () => void
  mock.access.mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
  const request = ensureAssetThumbnail('D:/cached-changing.mp4', 'video', 42)
  const rejected = expect(request).rejects.toThrow('发生变化')
  await vi.waitFor(() => expect(mock.access).toHaveBeenCalledTimes(1))
  mock.stat.mockResolvedValue(stat(300, 42, 2, 43))
  complete()
  await rejected
  expect(mock.video).not.toHaveBeenCalled()
})

it('写临时文件期间内容变化清理临时缓存，禁止发布旧身份目标', async () => {
  mock.video.mockResolvedValue(Buffer.from('thumbnail'))
  mock.writeFile.mockImplementation(async () => { mock.stat.mockResolvedValue(stat(300, 42, 2, 43)) })
  await expect(ensureAssetThumbnail('D:/changing-write.mp4', 'video', 42)).rejects.toThrow('发生变化')
  expect(mock.rename).not.toHaveBeenCalled()
  expect(mock.rm).toHaveBeenCalledWith(expect.stringContaining('.tmp'), { force: true })
})

it('stat尚未完成即取消，不创建解码或写入会话', async () => {
  let complete!: (value: ReturnType<typeof stat>) => void
  mock.stat.mockImplementation(() => new Promise<ReturnType<typeof stat>>(resolve => { complete = resolve }))
  const controller = new AbortController()
  const request = ensureAssetThumbnail('D:/cancel-before-stat.mp4', 'video', 42, controller.signal)
  controller.abort(new Error('取消源素材预览'))
  const rejected = expect(request).rejects.toBe(controller.signal.reason)
  complete(stat())
  await rejected
  expect(mock.video).not.toHaveBeenCalled()
  expect(mock.mkdir).not.toHaveBeenCalled()
})
