import { expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
const state = vi.hoisted(() => ({ dir: '', source: '', binary: process.env.HENJI_AUDIO_RENDER_FFMPEG ?? '' }))
vi.mock('./media', () => ({ audioEditCacheDirectory: () => state.dir, verifyAudioEditSource: vi.fn(), prepareAudioEditAudio: async () => state.source, identifyAudioEditSource: async () => ({ digest: 'synthetic-pcm' }), validateAudioEditAudio: vi.fn() }))
vi.mock('../video/ffmpeg-loader', async original => ({ ...await original<Record<string, unknown>>(), loadFfmpegPath: async () => state.binary }))
import { renderAudioEditProject } from './render'
const exec = promisify(execFile)

it.runIf(Boolean(state.binary))('explicit FFmpeg performance: ten-minute stereo source, gain/fades and cuts, cache hit and cut-only edit', async () => {
  state.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-audio-perf-')); state.source = path.join(state.dir, 'source.wav')
  try {
    await exec(state.binary, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=0.1|0.2:s=48000:d=600', '-c:a', 'pcm_f32le', state.source], { windowsHide: true })
    const p: AudioEditProjectDocument = { id: 'performance', name: '测量', source: { mediaType: 'audio', sourcePath: state.source, audioPath: state.source, sampleRate: 48000, channels: 2, durationFrames: 600 * 48000 }, transcript: [], suggestions: [], referenceScript: '', vstEnabled: false, revision: 1, createdAt: 1, updatedAt: 1,
      gainRegions: [{ id: 'gain', startFrame: 48000, endFrame: 96000, gainDb: -6.020599913279624, fadeInFrames: 4800, fadeOutFrames: 4800, enabled: true }], cuts: [{ id: 'cut', startFrame: 48000 * 500, endFrame: 48000 * 600, reason: 'manual', enabled: true }] }
    const time = async (): Promise<{ ms: number; result: Awaited<ReturnType<typeof renderAudioEditProject>> }> => { const start = performance.now(); const result = await renderAudioEditProject(p); return { ms: performance.now() - start, result } }
    const cold = await time(), warm = await time()
    p.cuts![0].startFrame = 48000 * 499
    const changed = await time()
    expect(cold.result.durationFrames).toBe(500 * 48000); expect(changed.result.durationFrames).toBe(499 * 48000)
    const samples = async (seconds: number): Promise<Buffer> => (await exec(state.binary, ['-v', 'error', '-ss', String(seconds), '-i', cold.result.audioPath, '-t', '0.01', '-f', 'f32le', 'pipe:1'], { encoding: 'buffer', windowsHide: true })).stdout
    const original = await samples(.5), attenuated = await samples(1.5)
    expect(original.readFloatLE(0)).toBeCloseTo(.1, 6); expect(original.readFloatLE(4)).toBeCloseTo(.2, 6)
    expect(attenuated.readFloatLE(0)).toBeCloseTo(.05, 6); expect(attenuated.readFloatLE(4)).toBeCloseTo(.1, 6)
    process.stdout.write(`${JSON.stringify({ input: '600s/48kHz/stereo/f32', coldMs: cold.ms, warmMs: warm.ms, cutEditMs: changed.ms, outputSeconds: changed.result.durationFrames / 48000 })}\n`)
  } finally { await fs.rm(state.dir, { recursive: true, force: true }) }
}, 120000)
