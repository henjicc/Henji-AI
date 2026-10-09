import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ root: '' }))

vi.mock('../appPaths', async () => {
  const nodeFs = await import('node:fs')
  const nodePath = await import('node:path')
  const folderDir = (key: string): string => {
    const dir = nodePath.join(mocks.root, key === 'uploads' ? 'Uploads' : key === 'generated' ? 'Media' : key)
    nodeFs.mkdirSync(dir, { recursive: true })
    return dir
  }
  return {
    getUserRootDir: () => mocks.root,
    getUserFolderDir: folderDir,
    getProgramStoreDir: (store: string) => nodePath.join(mocks.root, store),
  }
})

import {
  persistImageBytes,
  persistImageBytesTracked,
  releaseManagedGenerationMediaPaths,
  releaseManagedImagePaths,
  rollbackPersistedImageBytes,
} from './path-utils'
import { resetManagedMediaFileLeasesForTest } from './managed-media-leases'
import { persistImageSourceTracked } from './ops'

describe('受管生成媒体释放边界', () => {
  beforeEach(() => {
    resetManagedMediaFileLeasesForTest()
    mocks.root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-managed-media-'))
  })

  afterEach(() => {
    resetManagedMediaFileLeasesForTest()
    fs.rmSync(mocks.root, { recursive: true, force: true })
  })

  it('通用生成回滚只删除 Uploads 与 Media 内的目标', async () => {
    const upload = path.join(mocks.root, 'Uploads', 'image.png')
    const media = path.join(mocks.root, 'Media', 'video.mp4')
    fs.mkdirSync(path.dirname(upload), { recursive: true })
    fs.mkdirSync(path.dirname(media), { recursive: true })
    fs.writeFileSync(upload, 'image')
    fs.writeFileSync(media, 'video')

    await releaseManagedGenerationMediaPaths([upload, media])

    expect(fs.existsSync(upload)).toBe(false)
    expect(fs.existsSync(media)).toBe(false)
  })

  it('图层专用释放仍拒绝 Media，通用入口拒绝数据根外路径', async () => {
    const media = path.join(mocks.root, 'Media', 'video.mp4')
    const outside = path.join(path.dirname(mocks.root), 'outside.mp4')
    fs.mkdirSync(path.dirname(media), { recursive: true })
    fs.writeFileSync(media, 'video')
    fs.writeFileSync(outside, 'outside')

    await expect(releaseManagedImagePaths([media])).rejects.toThrow('Uploads')
    await expect(releaseManagedGenerationMediaPaths([outside])).rejects.toThrow('受管生成媒体')
    expect(fs.existsSync(media)).toBe(true)
    expect(fs.existsSync(outside)).toBe(true)
    fs.rmSync(outside, { force: true })
  })

  it('相同裁剪的并行 lease 交错释放时只由最后一方删除 Uploads 文件', async () => {
    const bytes = Buffer.from('same-crop')
    const [first, second] = await Promise.all([
      persistImageBytesTracked(bytes, 'png'),
      persistImageBytesTracked(bytes, 'png'),
    ])

    expect(first).toEqual({ filePath: second.filePath, created: true })
    expect(second.created).toBe(true)
    expect(await fs.promises.readFile(first.filePath)).toEqual(bytes)

    await releaseManagedGenerationMediaPaths([first.filePath])
    expect(fs.existsSync(first.filePath)).toBe(true)

    await releaseManagedGenerationMediaPaths([second.filePath])
    expect(fs.existsSync(first.filePath)).toBe(false)
  })

  it('批处理回滚与显式释放共享同一 Uploads lease 计数', async () => {
    const bytes = Buffer.from('same-layer-resource')
    const first = await persistImageBytesTracked(bytes, 'webp')
    const second = await persistImageBytesTracked(bytes, 'webp')

    await rollbackPersistedImageBytes(first)
    expect(fs.existsSync(first.filePath)).toBe(true)

    await releaseManagedImagePaths([second.filePath])
    expect(fs.existsSync(first.filePath)).toBe(false)
  })

  it('无进程内 lease 的既有内容寻址文件不会被声明为本次可释放资源', async () => {
    const bytes = Buffer.from('preexisting-authoritative-image')
    const filePath = await persistImageBytes(bytes, 'png')

    expect(await persistImageBytesTracked(bytes, 'png')).toEqual({ filePath, created: false })
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('tracked source 契约为并发调用分别返回可释放 lease', async () => {
    const bytes = Buffer.from('tracked-mask-source')
    const source = `data:image/png;base64,${bytes.toString('base64')}`

    const [first, second] = await Promise.all([
      persistImageSourceTracked(source),
      persistImageSourceTracked(source),
    ])

    expect(first).toEqual({
      imagePath: second.imagePath,
      createdFilePaths: [second.imagePath],
    })
    expect(second.createdFilePaths).toEqual([second.imagePath])

    await releaseManagedGenerationMediaPaths(first.createdFilePaths)
    expect(fs.existsSync(first.imagePath)).toBe(true)
    await releaseManagedGenerationMediaPaths(second.createdFilePaths)
    expect(fs.existsSync(first.imagePath)).toBe(false)
  })

  it('tracked source 不会取得启动前既有内容寻址文件的删除权', async () => {
    const bytes = Buffer.from('tracked-preexisting-mask')
    const imagePath = await persistImageBytes(bytes, 'png')
    const source = `data:image/png;base64,${bytes.toString('base64')}`

    await expect(persistImageSourceTracked(source)).resolves.toEqual({
      imagePath,
      createdFilePaths: [],
    })
    expect(fs.existsSync(imagePath)).toBe(true)
  })
})
