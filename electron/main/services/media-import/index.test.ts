import fsp from 'node:fs/promises'
vi.mock('../media-recycle/queue', () => ({ registerOwnedMedia: vi.fn() }))
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { createGigapixelTiff } from '../../../../src/tests/gigapixelTiff'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  root: '',
  allowMediaRoot: vi.fn(),
  probeLocalMedia: vi.fn(),
  loadSharp: vi.fn(),
  warmNativeMediaTools: vi.fn(),
  loggerInfo: vi.fn(),
}))

vi.mock('../../protocol', () => ({
  allowMediaRoot: mocks.allowMediaRoot,
}))
vi.mock('../image/path-utils', () => ({
  getUploadsDir: () => `${mocks.root}/Uploads`,
}))
vi.mock('../image/sharp-loader', () => ({ loadSharp: mocks.loadSharp }))
vi.mock('../logging', () => ({
  createMainLogger: () => ({
    trace: vi.fn(), debug: vi.fn(), info: mocks.loggerInfo, warn: vi.fn(), error: vi.fn(),
  }),
}))
vi.mock('./probe', () => ({
  probeLocalMedia: mocks.probeLocalMedia,
  warmNativeMediaTools: mocks.warmNativeMediaTools,
  writeVideoPoster: vi.fn(),
}))

import { importMediaFromBytes, importMediaFromPath, warmupMediaImportPipeline } from './index'
import { removeTemporaryDirectory } from '../../../../src/tests/removeTemporaryDirectory'
import { registerOwnedMedia } from '../media-recycle/queue'

vi.mock('../appPaths', () => ({ getProgramStoreDir: () => path.join(mocks.root, 'Thumbnails') }))

describe('main media import service', () => {
  it('十亿像素图片经正式路径导入生成可读预览', async () => {
    const sourcePath = path.join(mocks.root, 'large.tiff')
    await fsp.writeFile(sourcePath, createGigapixelTiff())
    // 与正式加载器一致，避免 Windows 上 libvips 缓存输入文件句柄妨碍临时目录清理。
    sharp.cache({ files: 0 })
    mocks.loadSharp.mockResolvedValue(sharp)
    const imported = await importMediaFromPath({ importId: 'large-image', sourcePath, expectedKind: 'image', ownership: 'referenced', verifyContent: true })
    if (imported.kind !== 'image') throw new Error('应导入图片')
    expect(imported.fullPath).toBe(sourcePath)
    expect(await sharp(imported.previewPath).metadata()).toMatchObject({ width: 512, height: 512 })
  })
  it('大图预览写一半失败后不缓存残片，下次重新生成并登记来源', async () => {
    const toFile = vi.fn(async (target: string) => { await fsp.writeFile(target, 'partial'); throw new Error('disk full') })
    const pipeline = { metadata: async () => ({ width: 2048, height: 1024 }), resize: () => pipeline, jpeg: () => pipeline, toFile }
    mocks.loadSharp.mockResolvedValue(() => pipeline)
    const input = { importId: 'preview-failure', bytes: Uint8Array.from([0xff, 0xd8, 0xff, 1]), fileName: 'large.jpg', expectedKind: 'image' as const }
    await expect(importMediaFromBytes(input)).rejects.toThrow('disk full')
    expect(await fsp.readdir(path.join(mocks.root, 'Thumbnails'))).toEqual([])
    toFile.mockImplementation(async target => { await fsp.writeFile(target, 'complete'); return undefined as never })
    const result = await importMediaFromBytes(input)
    if (result.kind !== 'image') throw new Error('image expected')
    expect(await fsp.readFile(result.previewPath, 'utf8')).toBe('complete')
    expect(toFile).toHaveBeenCalledTimes(2)
    expect(registerOwnedMedia).toHaveBeenCalledWith(result.previewPath, result.fullPath)
  })
  it('PCM 探测失败按格式契约导入为未知时长', async () => {
    mocks.probeLocalMedia.mockRejectedValue(new Error('no container'))
    await expect(importMediaFromBytes({ importId: 'pcm-import', bytes: Uint8Array.from([1, 2, 3]), fileName: 'voice.pcm', expectedKind: 'audio' })).resolves.toMatchObject({ kind: 'audio', mimeType: 'audio/pcm', durationSeconds: 0 })
  })
  beforeEach(async () => {
    mocks.root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-media-import-test-'))
    await fsp.mkdir(path.join(mocks.root, 'Uploads'), { recursive: true })
    mocks.allowMediaRoot.mockReset()
    mocks.probeLocalMedia.mockReset().mockResolvedValue({
      durationSeconds: 12.5,
      width: 0,
      height: 0,
      hasAudio: true,
    })
    mocks.loadSharp.mockReset().mockResolvedValue(vi.fn())
    mocks.warmNativeMediaTools.mockReset().mockResolvedValue(undefined)
    mocks.loggerInfo.mockReset()
  })

  afterEach(async () => {
    await removeTemporaryDirectory(mocks.root)
  })

  it('路径 managed 导入流式复制并按 SHA-256 去重', async () => {
    const sourcePath = path.join(mocks.root, 'source.mp3')
    await fsp.writeFile(sourcePath, Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 1, 2, 3]))

    const first = await importMediaFromPath({
      importId: 'import-test-0001',
      sourcePath,
      expectedKind: 'audio',
      ownership: 'managed',
    })
    const second = await importMediaFromPath({
      importId: 'import-test-0002',
      sourcePath,
      expectedKind: 'audio',
      ownership: 'managed',
    })

    expect(first.kind).toBe('audio')
    expect(first.fullPath).toBe(second.fullPath)
    expect(first.cacheHit).toBe(false)
    expect(second.cacheHit).toBe(true)
    expect(await fsp.readFile(first.fullPath)).toEqual(await fsp.readFile(sourcePath))
    expect(mocks.probeLocalMedia).toHaveBeenCalledTimes(2)
  })

  it('reference 保留原始 full path 并沿用目录登记', async () => {
    const sourcePath = path.join(mocks.root, 'voice.wav')
    await fsp.writeFile(sourcePath, Buffer.concat([
      Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(16),
    ]))

    const result = await importMediaFromPath({
      importId: 'import-test-0003',
      sourcePath,
      expectedKind: 'audio',
      ownership: 'referenced',
    })

    expect(result.fullPath).toBe(sourcePath)
    expect(result.ownership).toBe('referenced')
  })

  it('导入目录联接中的文件保留原引用和既有目录登记，不复制原件', async () => {
    const outside = path.join(mocks.root, 'outside'); const project = path.join(mocks.root, 'project')
    await fsp.mkdir(outside); await fsp.mkdir(project)
    const real = path.join(outside, 'voice.mp3'); await fsp.writeFile(real, 'ID3media')
    const link = path.join(project, 'link'); await fsp.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    const sourcePath = path.join(link, 'voice.mp3')
    expect(await importMediaFromPath({ importId: 'link-import', verifyContent: true, sourcePath, expectedKind: 'audio', ownership: 'referenced' })).toMatchObject({ fullPath: sourcePath, ownership: 'referenced' })
    expect(await fsp.readdir(path.join(mocks.root, 'Uploads'))).toEqual([])
  })

  it('bytes 后备内容寻址，伪装类型和非绝对路径被拒绝', async () => {
    const result = await importMediaFromBytes({
      importId: 'import-test-0004',
      bytes: Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0]),
      fileName: 'clip.mp3',
      expectedKind: 'audio',
    })
    expect(result.kind).toBe('audio')
    expect(result.fullPath.endsWith('.mp3')).toBe(true)

    await expect(importMediaFromBytes({
      importId: 'import-test-0005',
      bytes: Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0]),
      fileName: 'fake.png',
      expectedKind: 'image',
    })).rejects.toThrow('Unsupported or disguised media file')

    await expect(importMediaFromPath({
      importId: 'import-test-0006',
      sourcePath: 'relative.mp3',
      verifyContent: true,
      expectedKind: 'audio',
      ownership: 'managed',
    })).rejects.toThrow('绝对路径')
  })

  it('界面路径导入裸 PCM 与字节导入保持相同的未知时长行为', async () => {
    const sourcePath = path.join(mocks.root, 'voice.pcm'); await fsp.writeFile(sourcePath, Buffer.from([1, 2, 3]))
    mocks.probeLocalMedia.mockRejectedValue(new Error('no container'))
    await expect(importMediaFromPath({ importId: 'pcm-path', sourcePath, expectedKind: 'audio', ownership: 'referenced' })).resolves.toMatchObject({ kind: 'audio', mimeType: 'audio/pcm', durationSeconds: 0 })
    await expect(importMediaFromPath({ importId: 'pcm-assistant', sourcePath, expectedKind: 'audio', ownership: 'referenced', verifyContent: true })).rejects.toThrow('MEDIA_FORMAT_UNSUPPORTED')
  })

  it('预览写入失败保留原始错误名与码，去掉完整来源路径', async () => {
    const sourcePath = path.join(mocks.root, 'large.jpg'); await fsp.writeFile(sourcePath, Buffer.from([0xff, 0xd8, 0xff, 1]))
    const pipeline = { metadata: async () => ({ width: 2048, height: 1024 }), resize: () => pipeline, jpeg: () => pipeline,
      toFile: async () => { throw Object.assign(new Error(`EACCES: 写入预览失败 '${sourcePath}'`), { code: 'EACCES' }) } }
    mocks.loadSharp.mockResolvedValue(() => pipeline)
    const error = await importMediaFromPath({ importId: 'poster-failure', sourcePath, expectedKind: 'image', ownership: 'referenced' }).catch(value => value)
    expect(error).toMatchObject({ name: 'Error', code: 'EACCES', message: expect.stringContaining('写入预览失败') })
    expect(error.message).not.toContain(sourcePath)
  })

  it('预热覆盖图像、原生工具与临时文件清理，并记录分阶段耗时', async () => {
    await warmupMediaImportPipeline()

    expect(mocks.loadSharp).toHaveBeenCalledOnce()
    expect(mocks.warmNativeMediaTools).toHaveBeenCalledOnce()
    expect(mocks.loggerInfo).toHaveBeenCalledWith('媒体导入预热完成', expect.objectContaining({
      event: 'media_import.warmup.completed',
      context: expect.objectContaining({
        phases: expect.objectContaining({ sharp: expect.any(Number), native_tools: expect.any(Number) }),
      }),
    }))
  })
})
