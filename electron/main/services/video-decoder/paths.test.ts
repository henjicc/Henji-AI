import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveVideoDecoderExecutable, videoDecoderDiagnosticLimits, videoDecoderExecutableCandidates, videoDecoderExecutableOverride } from './paths'

const base = { resourcesPath: path.win32.join('C:', 'App', 'resources'), cwd: path.win32.join('D:', 'repo'), platform: 'win32' as const }

describe('video decoder paths', () => {
  it('prefers release over debug in development', () => {
    const candidates = videoDecoderExecutableCandidates({ ...base, isPackaged: false })
    expect(candidates).toEqual([
      path.win32.join('D:', 'repo', 'native', 'video-decoder', 'target', 'release', 'henji-video-decoder.exe'),
      path.win32.join('D:', 'repo', 'native', 'video-decoder', 'target', 'debug', 'henji-video-decoder.exe'),
    ])
    expect(resolveVideoDecoderExecutable({ ...base, isPackaged: false, exists: (candidate) => candidate.includes(`${path.win32.sep}debug${path.win32.sep}`) })).toBe(candidates[1])
  })

  it('uses the resources directory when packaged and nothing outside Windows', () => {
    expect(videoDecoderExecutableCandidates({ ...base, isPackaged: true })).toEqual([
      path.win32.join('C:', 'App', 'resources', 'resources', 'video-decoder', 'henji-video-decoder.exe'),
    ])
    expect(videoDecoderExecutableCandidates({ ...base, isPackaged: false, platform: 'darwin' })).toEqual([])
    expect(resolveVideoDecoderExecutable({ ...base, isPackaged: true, exists: () => false })).toBeNull()
  })

  it('development diagnostics override the executable and the memory budget, never in an installed app', () => {
    // 覆盖读取真实环境变量与文件系统，按宿主平台判定绝对路径；写死 `D:` 在 CI Linux 上不是绝对路径。
    const missing = path.resolve(path.sep, 'nowhere', 'henji-video-decoder.exe')
    const present = path.resolve(path.sep, 'repo', 'decoder.exe')
    const exists = (candidate: string) => candidate === present
    expect(videoDecoderExecutableOverride(false, {}, exists)).toBeUndefined()
    expect(videoDecoderExecutableOverride(false, { HENJI_VIDEO_DECODER_EXECUTABLE: missing }, exists)).toEqual({ path: null })
    expect(videoDecoderExecutableOverride(false, { HENJI_VIDEO_DECODER_EXECUTABLE: present }, exists)).toEqual({ path: present })
    expect(videoDecoderExecutableOverride(false, { HENJI_VIDEO_DECODER_EXECUTABLE: 'relative.exe' }, () => true)).toEqual({ path: null })
    expect(videoDecoderExecutableOverride(true, { HENJI_VIDEO_DECODER_EXECUTABLE: present }, exists)).toBeUndefined()
    expect(videoDecoderDiagnosticLimits(false, { HENJI_VIDEO_DECODER_VRAM_BUDGET_MB: '600' })).toEqual({ vramBytes: 600 * 1024 * 1024 })
    expect(videoDecoderDiagnosticLimits(false, { HENJI_VIDEO_DECODER_VRAM_BUDGET_MB: 'lots' })).toBeUndefined()
    expect(videoDecoderDiagnosticLimits(true, { HENJI_VIDEO_DECODER_VRAM_BUDGET_MB: '600' })).toBeUndefined()
  })
})
