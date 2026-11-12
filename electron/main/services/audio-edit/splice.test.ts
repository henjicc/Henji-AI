import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAudioEditDocumentContent } from '../../../../src/core/audioEdit/documentContent'
import type { AudioEditSpliceRequest } from '../../../../src/core/audioEdit/splice'
import type { AudioEditSourceMetadata } from '../../../../src/core/audioEdit/types'
import type { VideoEditLoudnessMeasurement } from '../../../../src/core/videoEdit/loudness'

const state = vi.hoisted(() => ({ root: '', takeFrames: 96_000, read: vi.fn(), measure: vi.fn(), process: vi.fn(), verify: vi.fn() }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
vi.mock('../appPaths', () => ({ getUserRootDir: () => state.root, getUserAudioRecordingsDir: () => path.join(state.root, 'Audio Recordings') }))
vi.mock('../documents/runtime', () => ({ getDocumentService: () => ({ readDocument: state.read }) }))
vi.mock('../media/shared', () => ({ resolveLocalMediaPath: async (file: string) => file }))
vi.mock('../video/ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg' }))
vi.mock('../audio/loudness', () => ({ measureAudioFileLoudness: state.measure }))
vi.mock('../media-recycle/queue', () => ({ registerOwnedMedia: vi.fn(), enqueueMediaCandidates: vi.fn() }))
vi.mock('./process', () => ({ runAudioEditProcess: state.process }))
vi.mock('./task-store', () => ({ runAudioEditTask: async (_id: string, _kind: string, work: (signal: AbortSignal, progress: (fraction: number) => void) => Promise<unknown>) => work(new AbortController().signal, () => {}) }))
vi.mock('./render', () => ({ audioEditSoundSourceKey: async (project: { source: AudioEditSourceMetadata }) => `${path.basename(project.source.sourcePath)}:${project.source.durationFrames}` }))
// 拼接写出在效果工作线程里跑；测试里同进程执行同一份实现
vi.mock('./effects-worker-client', async () => {
  const { runAudioEditPcmJob } = await import('./pcm-jobs')
  return { runAudioEditEffectsWorker: (job: import('./pcm-jobs').AudioEditPcmJob) => runAudioEditPcmJob(job) }
})
const RATE = 48000
const base = vi.hoisted(() => ({ file: '' }))
const source = { mediaType: 'audio' as const, sourcePath: '/old.wav', audioPath: '/old.wav', sampleRate: RATE, channels: 1, durationFrames: 192_000, ownership: 'managed' as const }
vi.mock('./media', () => ({
  verifyAudioEditSource: state.verify,
  prepareAudioEditAudio: async () => base.file,
  audioEditCacheDirectory: () => path.join(state.root, 'cache'),
  probeAudioEditSource: async (file: string) => ({ ...source, sourcePath: file, audioPath: file, durationFrames: state.takeFrames }),
}))
import { spliceAudioFile } from './splice'
import { createF32WavWriter, openF32Wav } from './pcm-wav'
import { findAudioLineageAncestor, resetAudioLineageForTests } from '../audio/lineage'
import { findAudioEditSourceSplices } from './source-splices'
import { audioEditSourceContentKey, digestWholeAudioEditSource } from './source-identity'

const oldSample = (frame: number): number => Math.sin(frame / 37) * 0.3
const takeSample = (frame: number): number => Math.cos(frame / 11) * 0.2
async function writeWav(file: string, frames: number, sample: (frame: number) => number): Promise<void> {
  const writer = await createF32WavWriter(file, RATE, 1, frames)
  await writer.write(Float32Array.from({ length: frames }, (_, frame) => sample(frame)))
  await writer.close()
}
const measurement: VideoEditLoudnessMeasurement = { integratedLufs: -36, shortTermLufs: null, truePeakDbtp: -25, samplePeakDbfs: null, durationSeconds: 2 }
let request: AudioEditSpliceRequest
beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-splice-test-'))
  resetAudioLineageForTests(path.join(state.root, 'lineage'))
  base.file = path.join(state.root, 'old.wav')
  await writeWav(base.file, source.durationFrames, oldSample)
  state.takeFrames = 96_000
  state.read.mockResolvedValue({ meta: { id: 'project', name: '录音', kind: 'audio_edit', createdAt: 1, updatedAt: 1, revision: 1 }, content: createAudioEditDocumentContent({ ...source, sourcePath: base.file, audioPath: base.file }) })
  state.measure.mockReset().mockResolvedValue(measurement)
  state.verify.mockReset()
  // 录音解码的替身：按参数里裁到的帧数写出同规格浮点 WAV
  state.process.mockReset().mockImplementation(async (_binary: string, args: string[]) => {
    const frames = Number(/atrim=end_sample=(\d+)/.exec(args[args.indexOf('-af') + 1])![1])
    await writeWav(args.at(-1)!, frames, takeSample)
  })
  request = { projectId: 'project', sourcePath: '/take.wav', startFrame: 48_000, endFrame: 144_000, requestId: crypto.randomUUID(), resultId: crypto.randomUUID(), matchRecordingLoudness: true }
})
afterEach(async () => { resetAudioLineageForTests(); await fs.rm(state.root, { recursive: true, force: true }) })

async function samples(file: string): Promise<Float32Array> {
  const reader = (await openF32Wav(file))!
  try { return await reader.read(0, reader.frames) } finally { await reader.close() }
}

it.each([
  ['等长替换', 48_000, 144_000, 96_000],
  ['中间插入', 100_000, 100_000, 30_000],
  ['末尾追加', 192_000, 192_000, 50_000],
])('%s：前后段样本原样、中间是录音，一遍写出；不探测结果、不整文件哈希，记下来历与声音来源拼接', async (_name, startFrame, endFrame, takeFrames) => {
  state.takeFrames = takeFrames
  const result = await spliceAudioFile({ ...request, startFrame, endFrame, matchRecordingLoudness: false })
  const durationFrames = source.durationFrames - (endFrame - startFrame) + takeFrames
  expect(result).toMatchObject({ insertedFrames: takeFrames, source: { ownership: 'managed', durationFrames, sampleRate: RATE, channels: 1, audioStreamIndex: 0 } })
  // 身份是写出时顺带算的整文件摘要（与事后整文件哈希相同），派生缓存键与拼接前不同——等长覆盖也一样
  expect(result.source.fingerprint).toBeUndefined()
  expect(result.source.identity).toEqual(await digestWholeAudioEditSource(result.source.sourcePath))
  expect(await audioEditSourceContentKey(result.source)).not.toBe(await audioEditSourceContentKey({ sourcePath: base.file }))
  const actual = await samples(result.source.sourcePath)
  const expected = Float32Array.from({ length: durationFrames }, (_, frame) => Math.fround(frame < startFrame ? oldSample(frame) : frame < startFrame + takeFrames ? takeSample(frame - startFrame) : oldSample(frame - takeFrames + endFrame - startFrame)))
  expect(Buffer.from(actual.buffer).equals(Buffer.from(expected.buffer))).toBe(true)
  // 唯一的子进程是解码录音：没有 -show_frames、没有 concat 二次复制
  expect(state.process).toHaveBeenCalledTimes(1)
  expect(state.verify).toHaveBeenCalledTimes(1)
  const lineage = await findAudioLineageAncestor(result.source.sourcePath, async ancestor => ancestor)
  expect(lineage).toMatchObject({ ancestorFrames: source.durationFrames, frames: durationFrames })
  expect(path.resolve(lineage!.ancestor).toLowerCase()).toBe(path.resolve(base.file).toLowerCase())
  // 长度不变时后段原位相同，只有录音段不同；长度变了拼接点之后都不按位置沿用
  expect(lineage!.dirty).toEqual([[startFrame, takeFrames === endFrame - startFrame ? startFrame + takeFrames : durationFrames]])
  expect(await findAudioEditSourceSplices(path.join(state.root, 'cache'), `old.wav:${source.durationFrames}`, `${path.basename(result.source.sourcePath)}:${durationFrames}`)).toEqual([
    { from: `old.wav:${source.durationFrames}`, to: `${path.basename(result.source.sourcePath)}:${durationFrames}`, start: startFrame, end: endFrame, inserted: takeFrames },
  ])
})

it('只测量实际覆盖区间，非破坏增益由返回值交给录音事务；复用输出时只核对文件头、测量一致', async () => {
  const result = await spliceAudioFile(request)
  expect(result.recordingGainDb).toBe(20)
  // 刚写出时量解码好的录音本身（与结果里这一段逐样本相同）；复用已发布结果时量结果里的这一段
  expect(state.measure).toHaveBeenCalledWith(expect.stringMatching(/take\.wav$/), 0, 96_000, RATE, expect.any(AbortSignal))
  state.measure.mockClear()
  state.process.mockClear()
  expect(await spliceAudioFile({ ...request, requestId: crypto.randomUUID() })).toEqual(result)
  expect(state.process).not.toHaveBeenCalled()
  expect(state.measure).toHaveBeenCalledWith(result.source.sourcePath, 48_000, 96_000, RATE, expect.any(AbortSignal))
})

it.each([
  [{ integratedLufs: -60, truePeakDbtp: -50 }, 30],
  [{ integratedLufs: -36, truePeakDbtp: -3 }, 2],
  [{ integratedLufs: -10, truePeakDbtp: -2 }, -6],
  [{ integratedLufs: null, truePeakDbtp: null }, undefined],
])('沿剪辑同一上限、真峰值和静音规则：%j', async (patch, gain) => {
  state.measure.mockResolvedValue({ ...measurement, ...patch })
  expect((await spliceAudioFile(request)).recordingGainDb).toBe(gain)
})

it('普通文件插入和不足 400 毫秒的录音均不测量、不添加增益', async () => {
  expect((await spliceAudioFile({ ...request, matchRecordingLoudness: false })).recordingGainDb).toBeUndefined()
  state.takeFrames = 4800
  request.endFrame = request.startFrame + 4800
  expect((await spliceAudioFile({ ...request, resultId: crypto.randomUUID() })).recordingGainDb).toBeUndefined()
  expect(state.measure).not.toHaveBeenCalled()
})

it('测量失败保留完整拼接文件供恢复，不把失败当作成功', async () => {
  state.measure.mockRejectedValueOnce(new Error('测量失败'))
  await expect(spliceAudioFile(request)).rejects.toThrow('测量失败')
  state.process.mockClear()
  expect((await spliceAudioFile({ ...request, requestId: crypto.randomUUID() })).recordingGainDb).toBe(20)
  expect(state.process).not.toHaveBeenCalled()
})
