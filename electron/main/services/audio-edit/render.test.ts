import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
const state = vi.hoisted(() => ({ dir: '', calls: [] as string[] }))
vi.mock('./media', () => ({ audioEditCacheDirectory: () => state.dir, verifyAudioEditSource: vi.fn(), prepareAudioEditAudio: async () => path.join(state.dir, 'source.wav'), identifyAudioEditSource: async () => ({ digest: 'a' }), validateAudioEditAudio: vi.fn() }))
vi.mock('./dsp-adapter', () => ({ runAudioRepair: async (_input: string, output: string) => { state.calls.push('repair'); await fs.writeFile(output, 'repaired') } }))
vi.mock('./processors', () => ({ audioEditProcessorCacheIdentity: async () => 'v1', processAudioEditVstChain: async (input: string, dir: string) => { state.calls.push('processor'); expect(path.basename(input)).toMatch(/^gain-/); const outputPath = path.join(dir, 'vst.wav'); await fs.writeFile(outputPath, 'processed'); return { outputPath, temporaryPaths: [outputPath] } } }))
vi.mock('../video/ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg', ffmpegFilterComplexFileArgs: async (_bin: string, script: string) => ['-filter_complex_script', script] }))
vi.mock('./process', () => ({ runAudioEditProcess: async (_bin: string, args: string[]) => { const script = await fs.readFile(args[args.indexOf('-filter_complex_script') + 1], 'utf8'); state.calls.push(script.includes('aeval') ? 'gain' : 'cuts'); await fs.writeFile(args.at(-1)!, script) } }))
import { renderAudioEditProject } from './render'
import { cachedAudioFile } from './render-cache'
import { audioRenderKey } from './render-cache'
import { buildProjectAudioEditTimeline } from '../../../../src/core/audioEdit/timeline'
let project: AudioEditProjectDocument
beforeEach(async () => {
  state.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-render-')); state.calls = []
  project = { id: 'test', name: '声音', source: { mediaType: 'audio', sourcePath: '/source.wav', audioPath: '/source.wav', durationFrames: 48000, sampleRate: 48000, channels: 1 }, referenceScript: '', transcript: [], suggestions: [], revision: 1, createdAt: 1, updatedAt: 1, vstEnabled: true,
    gainRegions: [{ id: 'g', startFrame: 0, endFrame: 24000, gainDb: -6, fadeInFrames: 0, fadeOutFrames: 0, enabled: true }],
    repairs: [{ id: 'r', startFrame: 1000, endFrame: 2000, lowHz: 100, highHz: 1000, kind: 'spectral_heal', strength: 1, enabled: true }], cuts: [{ id: 'c', startFrame: 24000, endFrame: 48000, reason: 'manual', enabled: true }] }
})
afterEach(async () => { await fs.rm(state.dir, { recursive: true, force: true }) })
it('orders shared stages and reuses unaffected caches on cut/gain edits; revision-only changes reuse audio', async () => {
  expect((await renderAudioEditProject(project)).durationFrames).toBe(24000)
  expect(state.calls).toEqual(['repair', 'gain', 'processor', 'cuts'])
  await renderAudioEditProject({ ...project, revision: 2 }); expect(state.calls).toHaveLength(4)
  project.cuts![0].endFrame = 36000; await renderAudioEditProject(project); expect(state.calls.slice(4)).toEqual(['cuts'])
  state.calls = []; project.gainRegions![0].gainDb = -12; await renderAudioEditProject(project); expect(state.calls).toEqual(['gain', 'processor', 'cuts'])
  state.calls = []; project.repairs![0].strength = .2; await renderAudioEditProject(project); expect(state.calls).toEqual(['repair', 'gain', 'processor', 'cuts'])
})
it('failed and cancelled cache builds never publish, and simultaneous readers share one build', async () => {
  await expect(cachedAudioFile(state.dir, 'bad', 'wav', async p => { await fs.writeFile(p, 'partial'); throw new Error('failed') })).rejects.toThrow('failed')
  expect(await fs.readdir(state.dir)).toEqual([])
  const build = vi.fn(async (p: string) => { await fs.writeFile(p, 'done') })
  const values = await Promise.all([cachedAudioFile(state.dir, 'ok', 'wav', build), cachedAudioFile(state.dir, 'ok', 'wav', build)])
  expect(values[0]).toBe(values[1]); expect(build).toHaveBeenCalledTimes(1)
  const controller = new AbortController()
  await expect(cachedAudioFile(state.dir, 'cancel', 'wav', async p => { await fs.writeFile(p, 'partial'); controller.abort() }, controller.signal)).rejects.toThrow()
  expect((await fs.readdir(state.dir))).toEqual(['ok.wav'])
})

it('剪辑引用和 WAV 共用带微淡变的渲染，旧硬切成品缓存不再命中', async () => {
  project.vstEnabled = false
  project.repairs = []
  project.gainRegions = []
  project.cuts![0] = { ...project.cuts![0], startFrame: 12000, endFrame: 24000 }
  const oldKey = audioRenderKey([path.join(state.dir, 'source.wav'), buildProjectAudioEditTimeline(project)])
  await fs.writeFile(path.join(state.dir, `finished-${oldKey}.wav`), '旧硬切缓存')
  const result = await renderAudioEditProject(project)
  expect(result.durationFrames).toBe(36000)
  expect(state.calls).toEqual(['cuts'])
  expect(result.audioPath).not.toBe(path.join(state.dir, `finished-${oldKey}.wav`))
  const graph = await fs.readFile(result.audioPath, 'utf8')
  expect(graph).toContain('afade=t=out:ss=11760:ns=240:curve=tri')
  expect(graph).toContain('afade=t=in:ss=0:ns=240:curve=tri')
  expect((await renderAudioEditProject(project)).audioPath).toBe(result.audioPath)
  expect(state.calls).toEqual(['cuts'])
})
