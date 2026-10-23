import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAudioEditDocumentContent } from '../../../../src/core/audioEdit/documentContent'
import type { AudioEditSpliceRequest } from '../../../../src/core/audioEdit/splice'
import type { VideoEditLoudnessMeasurement } from '../../../../src/core/videoEdit/loudness'
import { spliceAudioFile } from './splice'

const state = vi.hoisted(() => ({ root: '', takeFrames: 96_000, read: vi.fn(), measure: vi.fn(), process: vi.fn() }))
vi.mock('../appPaths', () => ({ getUserRootDir: () => state.root }))
vi.mock('../documents/runtime', () => ({ getDocumentService: () => ({ readDocument: state.read }) }))
vi.mock('../media/shared', () => ({ resolveLocalMediaPath: async (file: string) => file }))
vi.mock('../video/ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg' }))
vi.mock('../audio/loudness', () => ({ measureAudioFileLoudness: state.measure }))
vi.mock('../media-recycle/queue', () => ({ registerOwnedMedia: vi.fn(), enqueueMediaCandidates: vi.fn() }))
vi.mock('./process', () => ({ runAudioEditProcess: state.process }))
vi.mock('./task-store', () => ({ runAudioEditTask: async (_id: string, _kind: string, work: (signal: AbortSignal, progress: (fraction: number) => void) => Promise<unknown>) => work(new AbortController().signal, () => {}) }))
const source = { mediaType: 'audio' as const, sourcePath: '/old.wav', audioPath: '/old.wav', sampleRate: 48000, channels: 1, durationFrames: 192_000 }
vi.mock('./media', () => ({ verifyAudioEditSource: vi.fn(), probeAudioEditSource: async (file: string) => ({ ...source, sourcePath: file, audioPath: file, durationFrames: file === '/take.wav' ? state.takeFrames : 192_000 }) }))
const measurement: VideoEditLoudnessMeasurement = { integratedLufs: -36, shortTermLufs: null, truePeakDbtp: -25, samplePeakDbfs: null, durationSeconds: 2 }
let request: AudioEditSpliceRequest
beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-splice-test-'))
  state.takeFrames = 96_000
  state.read.mockResolvedValue({ meta: { id: 'project', name: '录音', kind: 'audio_edit', createdAt: 1, updatedAt: 1, revision: 1 }, content: createAudioEditDocumentContent(source) })
  state.measure.mockReset().mockResolvedValue(measurement)
  state.process.mockReset().mockImplementation(async (_binary: string, args: string[]) => fs.writeFile(args.at(-1)!, '原始采样'))
  request = { projectId: 'project', sourcePath: '/take.wav', startFrame: 48_000, endFrame: 144_000, requestId: crypto.randomUUID(), resultId: crypto.randomUUID(), matchRecordingLoudness: true }
})
afterEach(async () => { await fs.rm(state.root, { recursive: true, force: true }) })

it('只测量实际覆盖区间，非破坏增益由返回值交给录音事务；复用输出时测量一致', async () => {
  const result = await spliceAudioFile(request)
  expect(result.recordingGainDb).toBe(20)
  expect(state.measure).toHaveBeenCalledWith(result.source.sourcePath, 48_000, 96_000, 48_000, expect.any(AbortSignal))
  expect(await fs.readFile(result.source.sourcePath, 'utf8')).toBe('原始采样')
  state.process.mockClear()
  expect(await spliceAudioFile({ ...request, requestId: crypto.randomUUID() })).toEqual(result)
  expect(state.process).not.toHaveBeenCalled()
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
  expect((await spliceAudioFile(request)).recordingGainDb).toBeUndefined()
  expect(state.measure).not.toHaveBeenCalled()
})

it('测量失败保留完整拼接文件供恢复，不把失败当作成功', async () => {
  state.measure.mockRejectedValueOnce(new Error('测量失败'))
  await expect(spliceAudioFile(request)).rejects.toThrow('测量失败')
  state.process.mockClear()
  expect((await spliceAudioFile({ ...request, requestId: crypto.randomUUID() })).recordingGainDb).toBe(20)
  expect(state.process).not.toHaveBeenCalled()
})
