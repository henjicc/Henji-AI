import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
const state = vi.hoisted(() => ({ dir: '', calls: [] as string[] }))
vi.mock('../audio-separation/runtime', () => ({ separateAudioFile: vi.fn() }))
vi.mock('./media', () => ({ audioEditCacheDirectory: () => state.dir, verifyAudioEditSource: vi.fn(), prepareAudioEditAudio: async () => path.join(state.dir, 'source.wav'), identifyAudioEditSource: async () => ({ digest: 'a' }), validateAudioEditAudio: vi.fn() }))
vi.mock('./dsp-adapter', () => ({ runAudioRepair: async (_input: string, output: string) => { state.calls.push('repair'); await fs.writeFile(output, 'repaired') } }))
vi.mock('./processors', () => ({ audioEditProcessorCacheIdentity: async () => 'v1', processAudioEditVstChain: async (input: string, dir: string) => { state.calls.push('processor'); expect(path.basename(input)).toMatch(/^gain-/); const outputPath = path.join(dir, 'vst.wav'); await fs.writeFile(outputPath, 'processed'); return { outputPath, temporaryPaths: [outputPath] } } }))
vi.mock('../video/ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg' }))
vi.mock('./process', () => ({ runAudioEditProcess: async (_bin: string, args: string[]) => {
  // 不是浮点 WAV 的渲染源先转一份（这里写出一段 48000 帧的真 WAV）；音量区域在主进程直接乘，不再调用 FFmpeg
  state.calls.push('decode'); await writeWav(args.at(-1)!, new Float32Array(48000).fill(0.25))
} }))
import { renderAudioEditProject } from './render'
import { createF32WavWriter, openF32Wav } from './pcm-wav'
import { cachedAudioFile } from './render-cache'
import { audioRenderKey } from './render-cache'
import { buildProjectAudioEditTimeline } from '../../../../src/core/audioEdit/timeline'
async function writeWav(file: string, samples: Float32Array): Promise<void> {
  const writer = await createF32WavWriter(file, 48000, 1, samples.length)
  await writer.write(samples); await writer.close()
}
let project: AudioEditProjectDocument
beforeEach(async () => {
  state.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-render-')); state.calls = []
  await writeWav(path.join(state.dir, 'source.wav'), Float32Array.from({ length: 48000 }, (_, i) => (i < 24000 ? 0.5 : -0.5)))
  project = { id: 'test', name: '声音', source: { mediaType: 'audio', sourcePath: '/source.wav', audioPath: '/source.wav', durationFrames: 48000, sampleRate: 48000, channels: 1 }, referenceScript: '', transcript: [], suggestions: [], revision: 1, createdAt: 1, updatedAt: 1, vstEnabled: true,
    gainRegions: [{ id: 'g', startFrame: 0, endFrame: 24000, gainDb: -6, fadeInFrames: 0, fadeOutFrames: 0, enabled: true }],
    repairs: [{ id: 'r', startFrame: 1000, endFrame: 2000, lowHz: 100, highHz: 1000, kind: 'spectral_heal', strength: 1, enabled: true }], cuts: [{ id: 'c', startFrame: 24000, endFrame: 48000, reason: 'manual', enabled: true }] }
})
afterEach(async () => { await fs.rm(state.dir, { recursive: true, force: true }) })
it('orders shared stages and reuses unaffected caches on cut/gain edits; revision-only changes reuse audio', async () => {
  const first = await renderAudioEditProject(project)
  expect(first.durationFrames).toBe(24000)
  // 修复结果不是浮点 WAV 时先转一份再乘音量；效果链输出同样转一份再拼接
  expect(state.calls).toEqual(['repair', 'decode', 'processor', 'decode'])
  const gained = (await openF32Wav(path.join(state.dir, (await fs.readdir(state.dir)).find(name => name.startsWith('gain-'))!)))!
  const pcm = await gained.read(0, 48000); await gained.close()
  expect(pcm[0]).toBeCloseTo(0.25 * 10 ** (-6 / 20), 6); expect(pcm[23999]).toBeCloseTo(0.25 * 10 ** (-6 / 20), 6); expect(pcm[24000]).toBe(0.25)
  expect((await renderAudioEditProject({ ...project, revision: 2 })).audioPath).toBe(first.audioPath); expect(state.calls).toHaveLength(4)
  // 只改剪切：上游各阶段与转码缓存都复用，只重新拼接成片
  project.cuts![0].endFrame = 36000
  const recut = await renderAudioEditProject(project)
  expect(state.calls).toHaveLength(4); expect(recut.audioPath).not.toBe(first.audioPath); expect(recut.durationFrames).toBe(36000)
  state.calls = []; project.gainRegions![0].gainDb = -12; await renderAudioEditProject(project); expect(state.calls).toEqual(['processor', 'decode'])
  state.calls = []; project.repairs![0].strength = .2; await renderAudioEditProject(project); expect(state.calls).toEqual(['repair', 'decode', 'processor', 'decode'])
})
it('failed and cancelled cache builds never publish, and simultaneous readers share one build', async () => {
  await expect(cachedAudioFile(state.dir, 'bad', 'wav', async p => { await fs.writeFile(p, 'partial'); throw new Error('failed') })).rejects.toThrow('failed')
  expect(await fs.readdir(state.dir)).toEqual(['source.wav'])
  const build = vi.fn(async (p: string) => { await fs.writeFile(p, 'done') })
  const values = await Promise.all([cachedAudioFile(state.dir, 'ok', 'wav', build), cachedAudioFile(state.dir, 'ok', 'wav', build)])
  expect(values[0]).toBe(values[1]); expect(build).toHaveBeenCalledTimes(1)
  const controller = new AbortController()
  await expect(cachedAudioFile(state.dir, 'cancel', 'wav', async p => { await fs.writeFile(p, 'partial'); controller.abort() }, controller.signal)).rejects.toThrow()
  expect((await fs.readdir(state.dir)).sort()).toEqual(['ok.wav', 'source.wav'])
})

it('成品在主进程逐段拼接并交叉淡化：浮点 WAV 渲染源直接读，拼接点不再硬跳，旧成品缓存不再命中', async () => {
  project.vstEnabled = false
  project.repairs = []
  project.gainRegions = []
  project.cuts![0] = { ...project.cuts![0], startFrame: 12000, endFrame: 30000 }
  const oldKey = audioRenderKey(['splice-declick-v1', path.join(state.dir, 'source.wav'), buildProjectAudioEditTimeline(project), 48000])
  await fs.writeFile(path.join(state.dir, `finished-${oldKey}.wav`), '旧成品缓存')
  const result = await renderAudioEditProject(project)
  expect(result.durationFrames).toBe(30000)
  expect(state.calls).toEqual([])
  expect(result.audioPath).not.toBe(path.join(state.dir, `finished-${oldKey}.wav`))
  const reader = (await openF32Wav(result.audioPath))!
  expect(reader.frames).toBe(30000)
  const samples = await reader.read(0, 30000)
  await reader.close()
  let maxJump = 0
  for (let i = 1; i < samples.length; i++) maxJump = Math.max(maxJump, Math.abs(samples[i] - samples[i - 1]))
  expect(maxJump).toBeLessThan(0.01)
  expect(samples[0]).toBe(0.5)
  expect(samples[29999]).toBe(-0.5)
  expect((await renderAudioEditProject(project)).audioPath).toBe(result.audioPath)
})
