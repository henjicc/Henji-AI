import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import type { AudioEditGainRegion } from '../../../../src/core/audioEdit/regions'

const state = vi.hoisted(() => ({ project: null as unknown as AudioEditProjectDocument, wav: '', execFile: vi.fn(), prepareRender: vi.fn(), layers: [] as AudioEditGainRegion[][] }))
vi.mock('node:child_process', () => ({ execFile: state.execFile }))
vi.mock('../video/ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg' }))
vi.mock('./project-store', () => ({ readAudioEditProjectSnapshot: async () => state.project }))
vi.mock('./render', () => ({ prepareAudioEditRenderPlan: async (...args: unknown[]) => ({ base: await state.prepareRender(...args), layers: state.layers }) }))
vi.mock('./media', () => ({ prepareAudioEditAudio: async () => state.wav }))
vi.mock('./processors', () => ({ listAudioEditProcessors: async () => [] }))

import { prepareAudioEditPreviewChunk, resetAudioEditPreviewForTests } from './preview'
import { createF32WavWriter, openF32Wav } from './pcm-wav'
import { runAudioEditPcmJob } from './pcm-jobs'

let directory = ''
const sampleRate = 1000, channels = 2, frames = 10_000

async function writeRenderSource(): Promise<string> {
  const writer = await createF32WavWriter(state.wav, sampleRate, channels, frames)
  await writer.write(Float32Array.from({ length: frames * channels }, (_, index) => index / (frames * channels)))
  await writer.close()
  return state.wav
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-audio-preview-'))
  state.wav = path.join(directory, 'edited.wav')
  await writeRenderSource()
  state.project = { id: 'doc', revision: 1, source: { sampleRate, channels, durationFrames: frames } } as AudioEditProjectDocument
  // 和缓存层一样：文件不在就重新生成
  state.prepareRender.mockReset().mockImplementation(async () => await fs.access(state.wav).then(() => state.wav, writeRenderSource))
  state.execFile.mockReset()
  state.layers = []
})
afterEach(async () => {
  resetAudioEditPreviewForTests()
  await new Promise(resolve => setTimeout(resolve, 10))
  await fs.rm(directory, { recursive: true, force: true })
})

it('同一版本连续取块只推一次渲染源、直接随机读浮点 WAV，不起 FFmpeg；作品一变才重新推', async () => {
  for (let second = 0; second < 6; second++) {
    const chunk = await prepareAudioEditPreviewChunk({ projectId: 'doc', mode: 'edited', sourceStartFrame: second * sampleRate, frameCount: sampleRate })
    const pcm = new Float32Array(chunk.pcm)
    expect(chunk).toMatchObject({ sourceStartFrame: second * sampleRate, sourceEndFrame: (second + 1) * sampleRate, sampleRate, channels })
    expect(pcm[0]).toBeCloseTo(second * sampleRate * channels / (frames * channels), 6)
  }
  expect(state.prepareRender).toHaveBeenCalledTimes(1)
  expect(state.execFile).not.toHaveBeenCalled()
  state.project = { ...state.project, revision: 2 }
  await prepareAudioEditPreviewChunk({ projectId: 'doc', mode: 'edited', sourceStartFrame: 0, frameCount: sampleRate })
  expect(state.prepareRender).toHaveBeenCalledTimes(2)
})

it('区间音量与呼吸在取块时乘上，与整段乘好的文件逐样本相同', async () => {
  const region = (startFrame: number, endFrame: number, gainDb: number, fadeInFrames = 0, fadeOutFrames = 0): AudioEditGainRegion => ({ id: `${startFrame}`, startFrame, endFrame, gainDb, fadeInFrames, fadeOutFrames, enabled: true })
  state.layers = [[region(800, 2300, -12, 100, 100), region(5000, 5200, -120, 20, 20)], [region(0, 1500, 3.5), region(1200, 6000, -6, 700, 0)]]
  const whole = path.join(directory, 'whole.wav')
  await runAudioEditPcmJob({ kind: 'gains', input: state.wav, output: whole, layers: state.layers })
  const reference = (await openF32Wav(whole))!
  for (const start of [0, 777, 1999, 4900, 9500]) {
    const chunk = await prepareAudioEditPreviewChunk({ projectId: 'doc', mode: 'edited', sourceStartFrame: start, frameCount: 777 })
    const expected = await reference.read(start, chunk.sourceEndFrame - start)
    expect(new Float32Array(chunk.pcm)).toEqual(expected)
  }
  await reference.close()
})

it('读到结尾时只返回实际有的帧', async () => {
  const chunk = await prepareAudioEditPreviewChunk({ projectId: 'doc', mode: 'source', sourceStartFrame: frames - 300, frameCount: sampleRate })
  expect(chunk.sourceEndFrame).toBe(frames)
  expect(chunk.pcm.byteLength).toBe(300 * channels * 4)
})

it('渲染源缓存文件被清理掉后，下一块重新准备渲染源并读出声音', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await prepareAudioEditPreviewChunk({ projectId: 'doc', mode: 'edited', sourceStartFrame: 0, frameCount: sampleRate })
    // 句柄闲置到期关掉后，缓存清理才删得掉文件（Windows 上打开着的文件删不掉）
    vi.advanceTimersByTime(10_000)
  } finally { vi.useRealTimers() }
  await new Promise(resolve => setTimeout(resolve, 20))
  await fs.rm(state.wav)
  const chunk = await prepareAudioEditPreviewChunk({ projectId: 'doc', mode: 'edited', sourceStartFrame: sampleRate, frameCount: sampleRate })
  expect(chunk.pcm.byteLength).toBe(sampleRate * channels * 4)
  expect(state.prepareRender).toHaveBeenCalledTimes(2)
  await prepareAudioEditPreviewChunk({ projectId: 'doc', mode: 'edited', sourceStartFrame: 2 * sampleRate, frameCount: sampleRate })
  expect(state.prepareRender).toHaveBeenCalledTimes(2)
})

it('渲染源不是浮点 WAV 时按块交给 FFmpeg 解码', async () => {
  const pcm16 = path.join(directory, 'pcm16.wav')
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36, 4); header.write('WAVE', 8); header.write('fmt ', 12); header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(0, 40)
  await fs.writeFile(pcm16, header)
  state.prepareRender.mockImplementation(async () => pcm16)
  const decoded = Buffer.from(new Float32Array(300 * channels).fill(0.25).buffer)
  state.execFile.mockImplementation((_binary: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: Buffer) => void) => {
    expect(args).toEqual(expect.arrayContaining(['-ss', '0.200000000', '-i', pcm16, '-t', '0.300000000']))
    callback(null, decoded)
  })
  const chunk = await prepareAudioEditPreviewChunk({ projectId: 'doc', mode: 'edited', sourceStartFrame: 200, frameCount: 300 })
  expect(state.execFile).toHaveBeenCalledTimes(1)
  expect(chunk).toMatchObject({ sourceStartFrame: 200, sourceEndFrame: 500 })
  expect(new Float32Array(chunk.pcm)[0]).toBe(0.25)
})
