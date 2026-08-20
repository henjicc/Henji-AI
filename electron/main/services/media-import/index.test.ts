import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  root: '',
  allowMediaRoot: vi.fn(),
  probeLocalMedia: vi.fn(),
}))

vi.mock('../../protocol', () => ({
  allowMediaRoot: mocks.allowMediaRoot,
}))
vi.mock('../image/path-utils', () => ({
  getUploadsDir: () => `${mocks.root}/Uploads`,
  getDataRootDir: () => mocks.root,
}))
vi.mock('../image/sharp-loader', () => ({ loadSharp: vi.fn() }))
vi.mock('../logging', () => ({
  createMainLogger: () => ({
    trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}))
vi.mock('./probe', () => ({
  probeLocalMedia: mocks.probeLocalMedia,
  warmNativeMediaTools: vi.fn(),
  writeVideoPoster: vi.fn(),
}))

import { importMediaFromBytes, importMediaFromPath } from './index'

describe('main media import service', () => {
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
  })

  afterEach(async () => {
    await fsp.rm(mocks.root, { recursive: true, force: true })
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

  it('reference 保留原始 full path 并持久授权目录', async () => {
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
    expect(mocks.allowMediaRoot).toHaveBeenCalledWith(path.dirname(sourcePath))
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
      expectedKind: 'audio',
      ownership: 'managed',
    })).rejects.toThrow('absolute file path')
  })
})
