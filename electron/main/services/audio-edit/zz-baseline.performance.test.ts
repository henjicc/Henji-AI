import { expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
const state = vi.hoisted(() => ({ dir: '', source: '', binary: process.env.HENJI_AUDIO_RENDER_FFMPEG ?? '' }))
vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./media', () => ({ audioEditCacheDirectory: () => state.dir, verifyAudioEditSource: vi.fn(), prepareAudioEditAudio: async () => state.source, identifyAudioEditSource: async () => ({ digest: 'synthetic-speech' }), validateAudioEditAudio: vi.fn() }))
vi.mock('../video/ffmpeg-loader', async original => ({ ...await original<Record<string, unknown>>(), loadFfmpegPath: async () => state.binary }))
import { prepareAudioEditRenderSource } from './render'
const exec = promisify(execFile)

it.runIf(Boolean(state.binary))('baseline: ten-minute stereo, mouth clicks + breaths + gains, toggle one click', async () => {
  state.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-audio-blocks-')); state.source = path.join(state.dir, 'source.wav')
  try {
    await exec(state.binary, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=0.2*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*3*t))|0.15*sin(2*PI*330*t+1):s=48000:d=600', '-c:a', 'pcm_f32le', state.source], { windowsHide: true })
    const rate = 48000
    const clicks = Array.from({ length: 300 }, (_, index) => ({ startFrame: Math.round((index * 1.97 + 0.5) * rate), endFrame: Math.round((index * 1.97 + 0.5) * rate) + 240 }))
    const breaths = Array.from({ length: 200 }, (_, index) => ({ startFrame: Math.round((index * 2.9 + 1.2) * rate), endFrame: Math.round((index * 2.9 + 1.5) * rate) }))
    const project: AudioEditProjectDocument = { id: 'performance', name: '测量', source: { mediaType: 'audio', sourcePath: state.source, audioPath: state.source, sampleRate: rate, channels: 2, durationFrames: 600 * rate }, transcript: [], suggestions: [], referenceScript: '', revision: 1, createdAt: 1, updatedAt: 1,
      gainRegions: Array.from({ length: 50 }, (_, index) => ({ id: `g${index}`, startFrame: (index * 11 + 3) * rate, endFrame: (index * 11 + 5) * rate, gainDb: -6, fadeInFrames: 480, fadeOutFrames: 480, enabled: true })),
      effectChain: [
        { id: 'mc', kind: 'mouth_declick', enabled: true, sensitivity: 50, analyzed: true, clicks },
        { id: 'br', kind: 'breath', enabled: true, mode: 'attenuate', reductionDb: -12, analyzed: true, breaths },
      ] }
    const time = async (): Promise<number> => { const start = performance.now(); await prepareAudioEditRenderSource(project); return performance.now() - start }
    const cold = await time(), warm = await time()
    ;(project.effectChain![0] as { clicks: typeof clicks }).clicks = clicks.filter((_, index) => index !== 150)
    const toggled = await time()
    process.stdout.write(`${JSON.stringify({ input: '600s/48kHz/stereo/f32', coldMs: Math.round(cold), warmMs: Math.round(warm), toggleOneClickMs: Math.round(toggled) })}\n`)
    expect(toggled).toBeGreaterThan(0)
  } finally { await fs.rm(state.dir, { recursive: true, force: true }) }
}, 600000)
