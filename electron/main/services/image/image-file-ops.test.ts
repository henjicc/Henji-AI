import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ error: vi.fn(), debug: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/downloads' } }))
vi.mock('../appPaths', () => ({
  getProgramStoreDir: () => '/debug',
  getUserFolderDir: () => '/uploads',
  getUserRootDir: () => '/',
}))
vi.mock('../logging', () => ({ createMainLogger: () => mocks }))
vi.mock('./panorama-metadata', () => ({
  embedPanoramaMetadataInImage: async (bytes: Buffer) => ({ bytes, format: 'png' }),
}))

import { loadImage, saveImageSourceToDirectory, savePanoramaImageSourceToDirectory } from './image-file-ops'
import { encodeImageBase64, ensureUniquePath, hashImageBytes, persistImageBytesTracked, rollbackPersistedImageBytes, writeReservedImage } from './path-utils'

const target = path.join('/outputs', 'same.png')
const bytes = Buffer.from([0, 255, 128, 17, 12])
const source = `data:image/png;base64,${bytes.toString('base64')}`

function mockFileHandle(): fs.promises.FileHandle {
  return {
    writeFile: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as fs.promises.FileHandle
}

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('原子输出路径', () => {
  it('超过旧候选边界仍继续寻找，绝不返回已存在原路径', async () => {
    const handle = mockFileHandle()
    vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined)
    let attempts = 0
    const open = vi.spyOn(fs.promises, 'open').mockImplementation(async () => {
      if (attempts++ < 10001) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      return handle
    })
    const reserved = await ensureUniquePath(target)
    expect(reserved.filePath).toBe(path.join('/outputs', 'same-10001.png'))
    expect(open).toHaveBeenCalledTimes(10002)
    expect(open.mock.calls.every((call) => call[1] === 'wx')).toBe(true)
    expect(handle.writeFile).not.toHaveBeenCalled()
    await writeReservedImage(reserved, bytes)
  })

  it('所有候选都存在时可以取消，不返回碰撞路径或写入已有文件', async () => {
    const controller = new AbortController()
    vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined)
    const open = vi.spyOn(fs.promises, 'open').mockImplementation(async () => {
      if (open.mock.calls.length === 20) controller.abort()
      throw Object.assign(new Error('exists'), { code: 'EEXIST' })
    })
    await expect(ensureUniquePath(target, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(open).toHaveBeenCalledTimes(20)
  })

  it('两个并发同名保存得到不同路径且各自写入自己的句柄', async () => {
    const files = new Map<string, fs.promises.FileHandle>()
    vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined)
    vi.spyOn(fs.promises, 'open').mockImplementation(async (candidate) => {
      const filePath = String(candidate)
      if (files.has(filePath)) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      const handle = mockFileHandle()
      files.set(filePath, handle)
      return handle
    })
    const outputs = await Promise.all([
      saveImageSourceToDirectory(source, '/outputs', 'same.png'),
      savePanoramaImageSourceToDirectory(source, '/outputs', 'same.png'),
    ])
    expect(new Set(outputs).size).toBe(2)
    expect(outputs).toEqual([target, path.join('/outputs', 'same-1.png')])
    for (const handle of files.values()) {
      expect(handle.writeFile).toHaveBeenCalledWith(bytes, { signal: undefined })
      expect(handle.close).toHaveBeenCalledTimes(1)
    }
  })

  it.each(['failure', 'cancel'] as const)('%s 时关闭句柄并删除预留文件，保留原始错误', async (mode) => {
    const controller = new AbortController()
    const handle = mockFileHandle()
    const failure = new Error('disk full')
    vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined)
    vi.spyOn(fs.promises, 'open').mockResolvedValue(handle)
    const rm = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined)
    if (mode === 'failure') vi.mocked(handle.writeFile).mockRejectedValue(failure)
    else vi.mocked(handle.writeFile).mockImplementation(async () => { controller.abort() })
    const saving = saveImageSourceToDirectory(source, '/outputs', 'same.png', controller.signal)
    if (mode === 'failure') await expect(saving).rejects.toBe(failure)
    else await expect(saving).rejects.toMatchObject({ name: 'AbortError' })
    expect(handle.close).toHaveBeenCalled()
    expect(rm).toHaveBeenCalledWith(target, { force: true })
    expect(mocks.error).toHaveBeenCalledWith('图片写入失败', expect.objectContaining({ event: 'image.file.write.failed' }))
  })

  it('刚取得预留时取消，写入前就关闭并清理空文件', async () => {
    const controller = new AbortController()
    const handle = mockFileHandle()
    vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined)
    vi.spyOn(fs.promises, 'open').mockImplementation(async () => {
      controller.abort()
      return handle
    })
    const rm = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined)
    await expect(saveImageSourceToDirectory(source, '/outputs', 'same.png', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(handle.writeFile).not.toHaveBeenCalled()
    expect(handle.close).toHaveBeenCalledTimes(1)
    expect(rm).toHaveBeenCalledWith(target, { force: true })
  })

  it('内容寻址写入失败也清理预留，后续调用可以重试相同内容', async () => {
    const first = mockFileHandle()
    const retry = mockFileHandle()
    vi.mocked(first.writeFile).mockRejectedValue(new Error('disk full'))
    vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined)
    vi.spyOn(fs.promises, 'open').mockResolvedValueOnce(first).mockResolvedValueOnce(retry)
    const rm = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined)
    await expect(persistImageBytesTracked(bytes, 'png')).rejects.toThrow('disk full')
    const saved = await persistImageBytesTracked(bytes, 'png')
    expect(rm).toHaveBeenCalledWith(saved.filePath, { force: true })
    expect(saved.created).toBe(true)
    expect(retry.writeFile).toHaveBeenCalledWith(bytes, { signal: undefined })
    await rollbackPersistedImageBytes(saved)
  })

  it('非碰撞错误立即失败并记录日志', async () => {
    vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined)
    const error = Object.assign(new Error('denied'), { code: 'EACCES' })
    const open = vi.spyOn(fs.promises, 'open').mockRejectedValue(error)
    await expect(ensureUniquePath(target)).rejects.toBe(error)
    expect(open).toHaveBeenCalledTimes(1)
    expect(mocks.error).toHaveBeenCalledWith('预留输出路径失败', expect.objectContaining({ error }))
  })
})

describe('异步图片字节处理', () => {
  it('本地读取使用异步 fs，返回相同 MIME/base64', async () => {
    const read = vi.spyOn(fs.promises, 'readFile').mockResolvedValue(bytes)
    await expect(loadImage('/input/test.jpg')).resolves.toBe(`data:image/jpeg;base64,${bytes.toString('base64')}`)
    expect(read).toHaveBeenCalledWith('/input/test.jpg')
  })

  it('跨块边界的 hash/base64 保持原始字节语义且让出事件循环', async () => {
    const large = Buffer.alloc(3 * 1024 * 1024 + 2, 181)
    let interleaved = false
    setImmediate(() => { interleaved = true })
    const digest = await hashImageBytes(large)
    expect(interleaved).toBe(true)
    expect(digest).toBe(crypto.createHash('md5').update(large).digest('hex'))
    expect(await hashImageBytes(large, 'sha256')).toBe(crypto.createHash('sha256').update(large).digest('hex'))
    interleaved = false
    setImmediate(() => { interleaved = true })
    expect(await encodeImageBase64(large)).toBe(large.toString('base64'))
    expect(interleaved).toBe(true)
  })
})
