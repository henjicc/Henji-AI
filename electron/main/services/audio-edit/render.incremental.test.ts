import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import type { AudioEditGainRegion } from '../../../../src/core/audioEdit/regions'

const state = vi.hoisted(() => ({ dir: '', jobs: [] as Array<{ kind: string; frames: number }>, info: vi.fn() }))
// 整段 PCM 处理在效果工作线程里跑；测试里同进程执行同一份实现，并记下每次派活实际读写了多少帧
vi.mock('./effects-worker-client', async () => {
  const { runAudioEditPcmJob } = await import('./pcm-jobs')
  const { openF32Wav } = await import('./pcm-wav')
  return { runAudioEditEffectsWorker: async (job: import('./pcm-jobs').AudioEditPcmJob) => {
    const reader = (await openF32Wav(job.input))!
    const frames = job.kind === 'gains-patch' ? job.ranges.reduce((sum, [start, end]) => sum + end - start, 0) : reader.frames
    await reader.close()
    state.jobs.push({ kind: job.kind, frames })
    await runAudioEditPcmJob(job)
  } }
})
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: state.info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
vi.mock('../audio-separation/runtime', () => ({ separateAudioFile: vi.fn() }))
vi.mock('./media', () => ({ audioEditCacheDirectory: () => state.dir, verifyAudioEditSource: vi.fn(), prepareAudioEditAudio: async () => path.join(state.dir, 'source.wav'), validateAudioEditAudio: vi.fn() }))
// 修复的替身：与原生修复同样“复制整条、只改写选区”（选区内减半），用来验证上下游的增量机制。
vi.mock('./dsp-adapter', async () => {
  const actual = await vi.importActual<typeof import('./dsp-adapter')>('./dsp-adapter')
  return { ...actual, runAudioRepair: async (input: string, output: string, repair: { startFrame: number; endFrame: number }) => {
    await fs.copyFile(input, output)
    const { openF32Wav, openF32WavForPatch } = await import('./pcm-wav')
    const reader = (await openF32Wav(input))!, target = (await openF32WavForPatch(output))!
    const pcm = await reader.read(repair.startFrame, repair.endFrame - repair.startFrame)
    await target.write(repair.startFrame, pcm.map(value => value * 0.5))
    await reader.close(); await target.close()
  } }
})
vi.mock('./processors', () => ({ listAudioEditProcessors: async () => [] }))
vi.mock('../video/ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg' }))

import { prepareAudioEditRenderSource, renderAudioEditProject, resetAudioEditRenderForTests } from './render'
import { createF32WavWriter, openF32Wav } from './pcm-wav'
import { runAudioEditPcmJob } from './pcm-jobs'
import { audioEditGainLayer } from './sound-diff'
import { resetAudioLineageForTests } from '../audio/lineage'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '../../../../src/core/audioEdit/timeline'

// 两分钟单声道 48 kHz（576 万帧），足够看出“只重算改动的部分”与“整段”的差别。
const RATE = 48000, FRAMES = RATE * 120
const source = (): string => path.join(state.dir, 'source.wav')
const region = (id: string, startFrame: number, endFrame: number, gainDb: number, fades = 0): AudioEditGainRegion => ({ id, startFrame, endFrame, gainDb, fadeInFrames: fades, fadeOutFrames: fades, enabled: true })
let project: AudioEditProjectDocument

async function wholeGainsFile(input: string, layers: AudioEditGainRegion[][]): Promise<string> {
  const output = path.join(state.dir, `reference-${Math.random()}.wav`)
  await runAudioEditPcmJob({ kind: 'gains', input, output, layers })
  return output
}
const wholeGains = async (input: string, layers: AudioEditGainRegion[][]): Promise<Buffer> => fs.readFile(await wholeGainsFile(input, layers))
/** 两个文件逐字节相同；不同时报第一个不同的字节位置（整份 Buffer 的差异打印会耗尽内存）。 */
async function expectSameBytes(actual: string, expected: Buffer | string): Promise<void> {
  const a = await fs.readFile(actual), b = typeof expected === 'string' ? await fs.readFile(expected) : expected
  let first = -1
  for (let index = 0; index < Math.max(a.length, b.length); index++) if (a[index] !== b[index]) { first = index; break }
  expect({ length: a.length, first }).toEqual({ length: b.length, first: -1 })
}
/** 两个浮点 WAV 的样本逐值（按位）相同，文件头可以不同。 */
async function expectSameSamples(actual: string, expected: string): Promise<void> {
  const a = (await openF32Wav(actual))!, b = (await openF32Wav(expected))!
  let first = -1
  for (let start = 0; start < a.frames && first < 0; start += 1 << 20) {
    const count = Math.min(1 << 20, a.frames - start)
    const x = new Uint32Array((await a.read(start, count)).buffer), y = new Uint32Array((await b.read(start, count)).buffer)
    for (let index = 0; index < x.length; index++) if (x[index] !== y[index]) { first = start + index; break }
  }
  expect({ frames: a.frames, channels: a.channels, first }).toEqual({ frames: b.frames, channels: b.channels, first: -1 })
  await a.close(); await b.close()
}
/** 按 FFmpeg（pcm_f32le、-rf64 auto）的样子写原素材副本：fmt 18 字节，另有 JUNK、fact、LIST 块，数据区不从第 44 字节开始。 */
async function writeFfmpegStyleWav(file: string, samples: Float32Array): Promise<void> {
  const u32 = (value: number): Buffer => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes }
  const chunk = (id: string, body: Buffer): Buffer => Buffer.concat([Buffer.from(id, 'ascii'), u32(body.length), body, Buffer.alloc(body.length % 2)])
  const fmt = Buffer.alloc(18)
  fmt.writeUInt16LE(3, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(RATE, 4); fmt.writeUInt32LE(RATE * 4, 8); fmt.writeUInt16LE(4, 12); fmt.writeUInt16LE(32, 14)
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('JUNK', Buffer.alloc(28)), chunk('fmt ', fmt), chunk('fact', u32(samples.length)),
    chunk('LIST', Buffer.concat([Buffer.from('INFO'), chunk('ISFT', Buffer.from('Lavf61.7.100\0'))])), Buffer.from('data'), u32(data.length)])
  await fs.writeFile(file, Buffer.concat([Buffer.from('RIFF'), u32(body.length + data.length), body, data]))
}
const sourceSamples = (): Float32Array => Float32Array.from({ length: FRAMES }, (_, i) => Math.sin(i / 37) * 0.4 + ((i * 7919) % 1000) / 10000)
const editedEvents = (): Array<Record<string, unknown>> => state.info.mock.calls.filter(call => call[1]?.event === 'audio_edit.render.edited.completed').map(call => call[1].context)

beforeEach(async () => {
  state.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-incremental-')); state.jobs = []; state.info.mockReset()
  resetAudioEditRenderForTests(); resetAudioLineageForTests()
  const writer = await createF32WavWriter(source(), RATE, 1, FRAMES)
  await writer.write(sourceSamples())
  await writer.close()
  project = { id: 'long', name: '长口播', source: { mediaType: 'audio', sourcePath: '/source.wav', audioPath: '/source.wav', durationFrames: FRAMES, sampleRate: RATE, channels: 1, identity: { digest: 'd'.repeat(64), size: 1, mtimeMs: 1 } },
    referenceScript: '', transcript: [], suggestions: [], revision: 1, createdAt: 1, updatedAt: 1, gainRegions: [region('a', 10 * RATE, 12 * RATE, -6, 480)] }
})
afterEach(async () => { await fs.rm(state.dir, { recursive: true, force: true }) })

it('改一处区间音量：只重算这一处的帧，结果与整段从头乘一遍逐字节一致（原素材副本与整段输出同一种文件头）', async () => {
  const first = await prepareAudioEditRenderSource(project)
  // 上一版是原素材的浮点副本（什么都没改）：第一次加区间音量也只改写这 2 秒
  expect(state.jobs).toEqual([{ kind: 'gains-patch', frames: 2 * RATE }])
  await expectSameBytes(first, await wholeGains(source(), [audioEditGainLayer(project.gainRegions!)]))

  state.jobs = []
  project = { ...project, revision: 2, gainRegions: [...project.gainRegions!, region('b', 70 * RATE, 70 * RATE + 4800, -12, 240)] }
  const second = await prepareAudioEditRenderSource(project)
  expect(second).not.toBe(first)
  expect(state.jobs).toEqual([{ kind: 'gains-patch', frames: 4800 }])
  await expectSameBytes(second, await wholeGains(source(), [audioEditGainLayer(project.gainRegions!)]))
  expect(editedEvents().at(-1)).toMatchObject({ mode: 'incremental', recomputedFrames: 4800, durationFrames: FRAMES })
  // 来历：second 与 first 只差在新加的那一段
  const lineage = JSON.parse(await fs.readFile(`${second}.lineage.json`, 'utf8'))
  expect(lineage.parent).toMatchObject({ name: path.basename(first), dirty: [[70 * RATE, 70 * RATE + 4800]] })

  // 只换 id（呼吸、气口转成手动剪辑）不算改声音：同一份文件
  state.jobs = []
  project = { ...project, gainRegions: project.gainRegions!.map(item => ({ ...item, id: `${item.id}-manual` })) }
  expect(await prepareAudioEditRenderSource(project)).toBe(second)
  expect(state.jobs).toEqual([])
})

it('加一处修复：修复阶段照常处理，编辑后声音只按修复的选区重乘，与整段一致；重开软件（内存记录清空）也能沿用', async () => {
  await prepareAudioEditRenderSource(project)
  resetAudioEditRenderForTests(); resetAudioLineageForTests()
  state.jobs = []
  project = { ...project, revision: 2, repairs: [{ id: 'r', kind: 'spectral_heal', startFrame: 30 * RATE, endFrame: 30 * RATE + 9600, lowHz: 100, highHz: 4000, strength: 1, enabled: true }] }
  const repaired = await prepareAudioEditRenderSource(project)
  expect(state.jobs).toEqual([{ kind: 'gains-patch', frames: 9600 }])
  const base = path.join(state.dir, (await fs.readdir(state.dir)).find(name => name.startsWith('repair-') && name.endsWith('.wav'))!)
  await expectSameBytes(repaired, await wholeGains(base, [audioEditGainLayer(project.gainRegions!)]))
})

it('原素材副本由 FFmpeg 写出（文件头不同）时，改动落在第 0 帧与末帧也只重算这几帧，样本与整段乘一遍逐值相同', async () => {
  await writeFfmpegStyleWav(source(), sourceSamples())
  project = { ...project, gainRegions: [region('first', 0, 4800, -6, 100), region('last', FRAMES - 4800, FRAMES, 3, 100)] }
  const edited = await prepareAudioEditRenderSource(project)
  expect(state.jobs).toEqual([{ kind: 'gains-patch', frames: 9600 }])
  await expectSameSamples(edited, await wholeGainsFile(source(), [audioEditGainLayer(project.gainRegions!)]))
})

it('最近一份编辑后声音的记录结构不合法时整段，并写明原因', async () => {
  await prepareAudioEditRenderSource(project)
  resetAudioEditRenderForTests()
  await fs.writeFile(path.join(state.dir, 'edited-latest.json'), JSON.stringify({ format: 'audio-edit-edited-v1', name: 'gone.wav', stamp: '1', sound: { source: 's', frames: FRAMES, ops: [{ key: 'item:x', kind: 'future' }] } }))
  state.jobs = []
  project = { ...project, revision: 2, gainRegions: [...project.gainRegions!, region('b', 70 * RATE, 70 * RATE + 4800, -12)] }
  await prepareAudioEditRenderSource(project)
  expect(state.jobs).toEqual([{ kind: 'gains', frames: FRAMES }])
  expect(editedEvents().at(-1)).toMatchObject({ mode: 'full', fallbackReason: expect.stringContaining('不合法') })
})

it('整段处理的效果在改动下游时退回整段，并在日志里写明原因', async () => {
  await prepareAudioEditRenderSource(project)
  state.jobs = []
  project = { ...project, revision: 2, repairs: [{ id: 'r', kind: 'declick', startFrame: 30 * RATE, endFrame: 30 * RATE + 960, lowHz: 0, highHz: 24000, strength: 0.5, enabled: true }] }
  await prepareAudioEditRenderSource(project)
  expect(state.jobs).toEqual([{ kind: 'gains', frames: FRAMES }])
  expect(editedEvents().at(-1)).toMatchObject({ mode: 'full', fallbackReason: expect.stringContaining('整段处理') })
})

it('导出：拼接时乘末尾的呼吸处理与区间音量，与原来“先逐级整段乘出文件再拼接”的成品逐字节一致', async () => {
  const breaths = [{ startFrame: 5 * RATE, endFrame: 5 * RATE + 14_400 }, { startFrame: 11 * RATE + 3000, endFrame: 11 * RATE + 9000 }, { startFrame: 61 * RATE, endFrame: 61 * RATE + 1000 }]
  project = { ...project, gainRegions: [region('a', 10 * RATE, 12 * RATE, -6, 480), region('b', 11 * RATE, 40 * RATE, 4, 2400), region('c', 59 * RATE, 61 * RATE, -120, 960)],
    effectChain: [{ id: 'breath', kind: 'breath', enabled: true, mode: 'attenuate', reductionDb: -9, analyzed: true, breaths }],
    cuts: [{ id: 'x', startFrame: 11 * RATE + 100, endFrame: 20 * RATE, reason: 'manual', enabled: true }, { id: 'y', startFrame: 60 * RATE, endFrame: 60 * RATE + 4800, reason: 'manual', enabled: true }] }
  const rendered = await renderAudioEditProject(project)
  expect(state.jobs.map(job => job.kind)).toEqual(['splices'])
  // 原来的做法：呼吸处理整段乘出一份文件，区间音量再在它上面整段乘一份，拼接读最后那份
  const breathed = path.join(state.dir, 'old-breathed.wav'), gained = path.join(state.dir, 'old-gained.wav')
  const breathLayer = audioEditGainLayer(breaths.map(({ startFrame, endFrame }, index) => {
    const edge = Math.min(Math.round(RATE * 0.02), Math.floor((endFrame - startFrame) / 2))
    return region(`breath-${index}`, startFrame, endFrame, -9, edge)
  }))
  await runAudioEditPcmJob({ kind: 'gains', input: source(), output: breathed, layers: [breathLayer] })
  await runAudioEditPcmJob({ kind: 'gains', input: breathed, output: gained, layers: [audioEditGainLayer(project.gainRegions!)] })
  const spans = buildProjectAudioEditTimeline(project)
  const old = path.join(state.dir, 'old-finished.wav')
  await runAudioEditPcmJob({ kind: 'splices', input: gained, output: old, spans, durationFrames: editedDurationFrames(spans) })
  await expectSameBytes(rendered.audioPath, old)
  const reader = (await openF32Wav(rendered.audioPath))!
  expect(reader.frames).toBe(editedDurationFrames(spans)); await reader.close()
})
