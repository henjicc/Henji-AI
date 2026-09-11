import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  writeImage: vi.fn(), createFromBuffer: vi.fn(), readFile: vi.fn(), resolveSourceBytes: vi.fn(),
  info: vi.fn(), error: vi.fn(),
}))
vi.mock('electron', () => ({ clipboard: { writeImage: mocks.writeImage }, nativeImage: { createFromBuffer: mocks.createFromBuffer } }))
vi.mock('node:fs/promises', () => ({ default: { readFile: mocks.readFile } }))
vi.mock('./image/source', () => ({ resolveSourceBytes: mocks.resolveSourceBytes }))
vi.mock('./logging/main-logger', () => ({ createMainLogger: () => mocks }))

import { writeImageFromPath, writeImageFromSource } from './clipboard'
import { loadSharp } from './image/sharp-loader'

describe('共享图片剪贴板写入', () => {
  beforeEach(() => { vi.resetAllMocks() })

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
    expect(mocks.writeImage).toHaveBeenCalledTimes(1)
    expect(mocks.writeImage).toHaveBeenCalledWith(image)
    expect(mocks.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'clipboard.image_write.completed' }))
  })

  it('读取失败原样上抛并记录阶段，不接触系统剪贴板', async () => {
    const error = new Error('read failed')
    mocks.readFile.mockRejectedValue(error)
    await expect(writeImageFromPath('/missing.png')).rejects.toBe(error)
    expect(mocks.writeImage).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ error, context: expect.objectContaining({ stage: 'read' }) }))
  })

  it('系统剪贴板拒绝写入时保留错误且不记录成功', async () => {
    const sharp = await loadSharp()
    mocks.resolveSourceBytes.mockResolvedValue({ bytes: await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer() })
    mocks.createFromBuffer.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) })
    const error = new Error('write failed')
    mocks.writeImage.mockImplementation(() => { throw error })
    await expect(writeImageFromSource('/image.png')).rejects.toBe(error)
    expect(mocks.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ error, context: expect.objectContaining({ stage: 'write' }) }))
    expect(mocks.info).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'clipboard.image_write.completed' }))
  })
})
