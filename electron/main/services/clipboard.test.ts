import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const mocks = vi.hoisted(() => ({
  write: vi.fn(), read: vi.fn(), createFromBuffer: vi.fn(), readFile: vi.fn(), resolveSourceBytes: vi.fn(),
  info: vi.fn(), error: vi.fn(), warn: vi.fn(), stat: vi.fn(), boundedRead: vi.fn(),
}))
vi.mock('electron', () => ({
  clipboard: { write: mocks.write, read: mocks.read },
  ClipboardItem: class { constructor(readonly data: Record<string, Blob>) {} },
  nativeImage: { createFromBuffer: mocks.createFromBuffer },
}))
vi.mock('node:fs/promises', () => ({ default: { readFile: mocks.readFile, stat: mocks.stat } }))
vi.mock('./system', () => ({ readFileBytes: mocks.boundedRead }))
vi.mock('./image/source', () => ({ resolveSourceBytes: mocks.resolveSourceBytes }))
vi.mock('./logging/main-logger', () => ({ createMainLogger: () => mocks }))

import { readClipboardFiles, readClipboardImage, writeImageFromPath, writeImageFromSource } from './clipboard'
import { loadSharp } from './image/sharp-loader'

/** Electron 44 的异步剪贴板项：types 与 getType。 */
function item(data: Record<string, string | Buffer>) {
  return { types: Object.keys(data), getType: async (type: string) => new Blob([data[type]]) }
}
const png = (bytes = 'image') => [item({ 'image/png': Buffer.from(bytes) })]
const nothing = () => [] as ReturnType<typeof item>[]

function setFilePaths(paths: string[]): void {
  mocks.read.mockResolvedValue([item({ 'text/uri-list': paths.map(file => pathToFileURL(file).href).join('\r\n') })])
}

describe('共享图片剪贴板写入', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue(png()) })

  it('已经公布图片格式而首次位图暂不可读时，异步重读原生图片', async () => {
    mocks.read.mockResolvedValueOnce(nothing()).mockResolvedValue(png())
    expect(await readClipboardImage()).toMatchObject({ dataUrl: `data:image/png;base64,${Buffer.from('image').toString('base64')}`, origin: 'bitmap' })
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(mocks.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'clipboard.image_read.deferred', context: expect.objectContaining({ found: true }) }))
  })

  it('格式枚举暂时为空也重读原生位图，不把锁争用当成没有图片', async () => {
    mocks.read.mockResolvedValueOnce([item({ 'text/plain': 'x' })]).mockResolvedValue(png())
    expect(await readClipboardImage()).toMatchObject({ origin: 'bitmap' })
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })

  it('没有图片格式且始终为空时有界结束，空剪贴板仍返回 null', async () => {
    mocks.read.mockResolvedValue(nothing())
    expect(await readClipboardImage()).toBeNull()
    expect(mocks.read.mock.calls.length).toBeGreaterThan(1)
  })

  it('文件图片回退先筛选类型，视频不读取，只读第一张有界图片', async () => {
    const imagePath = path.resolve('image.png')
    setFilePaths([path.resolve('huge.mp4'), imagePath, path.resolve('second.jpg')])
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 3 })
    mocks.boundedRead.mockResolvedValue(new Uint8Array([1, 2, 3]))
    expect(await readClipboardImage()).toMatchObject({ origin: 'file', name: 'image.png', dataUrl: 'data:image/png;base64,AQID' })
    expect(mocks.boundedRead).toHaveBeenCalledOnce()
    expect(mocks.boundedRead).toHaveBeenCalledWith(imagePath, { maxBytes: 16 * 1024 * 1024 })
    expect(mocks.readFile).not.toHaveBeenCalled()
  })

  it('超大图片不读；文件列表返回路径，读取失败记录警告', async () => {
    setFilePaths([path.resolve('huge.png')])
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 100 * 1024 * 1024 })
    expect(await readClipboardImage()).toBeNull()
    expect(await readClipboardFiles()).toEqual([{ path: path.resolve('huge.png'), size: 100 * 1024 * 1024, mimeType: 'image/png' }])
    expect(mocks.readFile).not.toHaveBeenCalled(); expect(mocks.boundedRead).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalled()
    mocks.stat.mockRejectedValue(new Error('文件已移除'))
    expect(await readClipboardFiles()).toEqual([])
    expect(mocks.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ error: expect.any(Error) }))
  })

  it('剪贴板大小不影响路径 DTO：大视频和图片只返回元数据，完全不读取字节', async () => {
    setFilePaths([path.resolve('large.mp4'), path.resolve('image.png')])
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 2 * 1024 * 1024 * 1024 })
    const files = await readClipboardFiles()
    expect(files).toEqual([
      { path: path.resolve('large.mp4'), mimeType: 'video/mp4', size: 2 * 1024 * 1024 * 1024 },
      { path: path.resolve('image.png'), mimeType: 'image/png', size: 2 * 1024 * 1024 * 1024 },
    ])
    expect(mocks.boundedRead).not.toHaveBeenCalled(); expect(mocks.readFile).not.toHaveBeenCalled()
  })

  it('公布的图片始终不可读时有界结束，保留实际失败事实', async () => {
    mocks.read.mockResolvedValue([item({ 'image/png': Buffer.alloc(0) })])
    expect(await readClipboardImage()).toBeNull()
    expect(mocks.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'clipboard.image_read.deferred', context: expect.objectContaining({ found: false }) }))
  })

  it.each(['path', 'source'])('%s 入口保留像素并记录完成状态', async (kind) => {
    const sharp = await loadSharp()
    const input = await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer()
    mocks.readFile.mockResolvedValue(input)
    mocks.resolveSourceBytes.mockResolvedValue({ bytes: input })
    const image = { isEmpty: () => false, getSize: () => ({ width: 3, height: 2 }) }
    mocks.createFromBuffer.mockReturnValue(image)
    await (kind === 'path' ? writeImageFromPath('/image.png') : writeImageFromSource('data:image/png;base64,test'))
    const png = mocks.createFromBuffer.mock.calls[0][0] as Buffer
    expect(await sharp(png).raw().toBuffer()).toEqual(await sharp(input).raw().toBuffer())
    expect(mocks.write).toHaveBeenCalledTimes(1)
    const written = (mocks.write.mock.calls[0][0] as Array<{ data: Record<string, Blob> }>)[0].data['image/png']
    expect(Buffer.from(await written.arrayBuffer()).equals(png)).toBe(true)
    expect(mocks.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'clipboard.image_write.completed' }))
  })

  it('读取失败原样上抛并记录阶段，不接触系统剪贴板', async () => {
    const error = new Error('read failed')
    mocks.readFile.mockRejectedValue(error)
    await expect(writeImageFromPath('/missing.png')).rejects.toBe(error)
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ error, context: expect.objectContaining({ stage: 'read' }) }))
  })

  it('系统剪贴板拒绝写入时保留错误且不记录成功', async () => {
    const sharp = await loadSharp()
    mocks.resolveSourceBytes.mockResolvedValue({ bytes: await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer() })
    mocks.createFromBuffer.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) })
    const error = new Error('write failed')
    mocks.write.mockRejectedValue(error)
    await expect(writeImageFromSource('/image.png')).rejects.toBe(error)
    expect(mocks.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ error, context: expect.objectContaining({ stage: 'write' }) }))
    expect(mocks.info).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'clipboard.image_write.completed' }))
  })

  it('写入后始终读不回图片时拒绝成功，记录确认阶段', async () => {
    const sharp = await loadSharp()
    mocks.resolveSourceBytes.mockResolvedValue({ bytes: await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer() })
    mocks.createFromBuffer.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) })
    mocks.read.mockResolvedValue(nothing())
    await expect(writeImageFromSource('/image.png')).rejects.toThrow('无法读回')
    expect(mocks.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ context: expect.objectContaining({ stage: 'confirm' }) }))
    expect(mocks.info).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'clipboard.image_write.completed' }))
  })
})
