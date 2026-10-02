import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveVideoDecoderExecutable, videoDecoderExecutableCandidates } from './paths'

const base = { resourcesPath: path.join('C:', 'App', 'resources'), cwd: path.join('D:', 'repo'), platform: 'win32' as const }

describe('video decoder paths', () => {
  it('prefers release over debug in development', () => {
    const candidates = videoDecoderExecutableCandidates({ ...base, isPackaged: false })
    expect(candidates).toEqual([
      path.join('D:', 'repo', 'native', 'video-decoder', 'target', 'release', 'henji-video-decoder.exe'),
      path.join('D:', 'repo', 'native', 'video-decoder', 'target', 'debug', 'henji-video-decoder.exe'),
    ])
    expect(resolveVideoDecoderExecutable({ ...base, isPackaged: false, exists: (candidate) => candidate.includes(`${path.sep}debug${path.sep}`) })).toBe(candidates[1])
  })

  it('uses the resources directory when packaged and nothing outside Windows', () => {
    expect(videoDecoderExecutableCandidates({ ...base, isPackaged: true })).toEqual([
      path.join('C:', 'App', 'resources', 'resources', 'video-decoder', 'henji-video-decoder.exe'),
    ])
    expect(videoDecoderExecutableCandidates({ ...base, isPackaged: false, platform: 'darwin' })).toEqual([])
    expect(resolveVideoDecoderExecutable({ ...base, isPackaged: true, exists: () => false })).toBeNull()
  })
})
