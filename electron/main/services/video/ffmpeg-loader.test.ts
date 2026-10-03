import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

import { ensureExecutableBinary, ffmpegFilterComplexFileArgs, loadFfmpegPath, loadFfprobePath, unifiedFfmpegDirectory, unifiedMediaBinaryPath, type MediaBinaryContext } from './ffmpeg-loader'

const pointer = JSON.stringify({ version: 'n9.0.2-17-g2a571b6068', binDir: 'ffmpeg-n9.0.2-17-g2a571b6068-win64-gpl-shared-9.0/bin' })
const base: MediaBinaryContext = {
  platform: 'win32',
  isPackaged: false,
  resourcesPath: path.win32.join('C:', 'App', 'resources'),
  cwd: path.win32.join('D:', 'repo'),
  readText: () => pointer,
}

describe('统一 FFmpeg 定位（重要记录 014）', () => {
  it('开发环境按 current.json 指向的包 bin 目录定位 ffmpeg.exe / ffprobe.exe', () => {
    let read = ''
    const directory = unifiedFfmpegDirectory({ ...base, readText: (file) => { read = file; return pointer } })
    expect(read).toBe(path.win32.join('D:', 'repo', 'native', 'video-decoder', 'ffmpeg', 'current.json'))
    expect(directory).toBe(path.win32.join('D:', 'repo', 'native', 'video-decoder', 'ffmpeg', 'ffmpeg-n9.0.2-17-g2a571b6068-win64-gpl-shared-9.0', 'bin'))
    expect(unifiedMediaBinaryPath('ffprobe', base)).toBe(path.win32.join(directory ?? '', 'ffprobe.exe'))
  })

  it('打包后与原生解码服务同目录 resources/video-decoder，不读指针', () => {
    const context = { ...base, isPackaged: true, readText: () => { throw new Error('打包后不得读取开发指针') } }
    expect(unifiedMediaBinaryPath('ffmpeg', context)).toBe(path.win32.join('C:', 'App', 'resources', 'resources', 'video-decoder', 'ffmpeg.exe'))
  })

  it('非 Windows 不走统一构建（维持 ffmpeg-ffprobe-static）', () => {
    expect(unifiedFfmpegDirectory({ ...base, platform: 'darwin' })).toBeNull()
    expect(unifiedMediaBinaryPath('ffmpeg', { ...base, platform: 'linux', isPackaged: true })).toBeNull()
  })

  it('指针缺失或越界时给出修复方式，而不是退回旧的静态包', () => {
    expect(() => unifiedFfmpegDirectory({ ...base, readText: () => null })).toThrow(/video-decoder-ffmpeg\.cjs ensure/)
    expect(() => unifiedFfmpegDirectory({ ...base, readText: () => '{' })).toThrow(/定位指针无效/)
    expect(() => unifiedFfmpegDirectory({ ...base, readText: () => JSON.stringify({ binDir: '../../evil/bin' }) })).toThrow(/定位指针无效/)
    expect(() => unifiedFfmpegDirectory({ ...base, readText: () => JSON.stringify({ binDir: 'C:/evil/bin' }) })).toThrow(/定位指针无效/)
  })
})

describe('从文件读取滤镜图的参数按二进制自身能力选择（任务 3.7）', () => {
  const modernHelp = '-filter_complex <graph_description>  create a complex filtergraph\n-filter_complex_threads  number of threads for -filter_complex\n'
  const legacyHelp = '-filter_complex graph_description  create a complex filtergraph\n-filter_complex_script filename  read complex filtergraph description from a file\n'

  it('FFmpeg 8 起没有 -filter_complex_script，改用 -/filter_complex；6.1 仍用旧写法', async () => {
    await expect(ffmpegFilterComplexFileArgs('modern-ffmpeg', 'g.txt', async () => modernHelp)).resolves.toEqual(['-/filter_complex', 'g.txt'])
    await expect(ffmpegFilterComplexFileArgs('legacy-ffmpeg', 'g.txt', async () => legacyHelp)).resolves.toEqual(['-filter_complex_script', 'g.txt'])
  })

  it('同一二进制只查一次选项列表；查询失败不缓存', async () => {
    let calls = 0
    const help = async () => { calls += 1; return modernHelp }
    await ffmpegFilterComplexFileArgs('cached-ffmpeg', 'a.txt', help)
    await ffmpegFilterComplexFileArgs('cached-ffmpeg', 'b.txt', help)
    expect(calls).toBe(1)
    await expect(ffmpegFilterComplexFileArgs('flaky-ffmpeg', 'a.txt', async () => { throw new Error('spawn EBUSY') })).rejects.toThrow('spawn EBUSY')
    await expect(ffmpegFilterComplexFileArgs('flaky-ffmpeg', 'a.txt', async () => legacyHelp)).resolves.toEqual(['-filter_complex_script', 'a.txt'])
  })
})

const repoPointer = path.join(process.cwd(), 'native', 'video-decoder', 'ffmpeg', 'current.json')

// 真实仓库：Windows 上 loadFfmpegPath/loadFfprobePath 必须解析到与原生解码服务同一份 9.0 GPL 构建。
describe.runIf(process.platform === 'win32' && existsSync(repoPointer))('统一 FFmpeg 真实定位', () => {
  it('ffmpeg / ffprobe 来自同一包且为 9.0 GPL 构建', async () => {
    const [ffmpeg, ffprobe] = await Promise.all([loadFfmpegPath(), loadFfprobePath()])
    expect(path.dirname(ffmpeg)).toBe(path.dirname(ffprobe))
    expect(ffmpeg).not.toMatch(/ffmpeg-ffprobe-static/)
    const version = execFileSync(ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8' })
    expect(version).toMatch(/^ffmpeg version n9\.0\./)
    expect(version).toMatch(/--enable-gpl/)
    expect(version).toMatch(/--enable-libx264/)
  })
})

describe.runIf(process.platform !== 'win32')('ensureExecutableBinary', () => {
  let tempDir = ''

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('修复开发目录里被 npm 缓存丢失的可执行权限', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-binary-mode-'))
    const binaryPath = path.join(tempDir, 'ffmpeg')
    await fs.writeFile(binaryPath, '#!/bin/sh\nexit 0\n', { mode: 0o644 })

    await expect(ensureExecutableBinary(binaryPath)).resolves.toBe(binaryPath)
    expect((await fs.stat(binaryPath)).mode & 0o111).not.toBe(0)
  })
})
