import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'

// 真实 FFmpeg 子进程：CI 冷启动首个用例常超过默认 5 秒，给集成测试留足时间。
vi.setConfig({ testTimeout: 60_000 })
const state = vi.hoisted(() => ({ root: '', project: undefined as AudioEditProjectDocument | undefined, pending: true }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
vi.mock('../db', () => ({ getDb: vi.fn() }))
vi.mock('../appPaths', () => ({ getProgramStoreDir: () => state.root }))
vi.mock('../media/shared', () => ({ resolveLocalMediaPath: async (value: string) => value }))
vi.mock('../media/media-cache-runtime', () => ({ getMediaCacheManager: () => ({ categoryDirectory: (_category: string, id: string) => path.join(state.root, 'cache', id) }) }))
vi.mock('./project-store', () => ({ requireAudioEditProject: vi.fn(), readAudioEditProjectSnapshot: async () => state.project }))
vi.mock('./task-store', async () => ({ ...await vi.importActual<typeof import('./task-store')>('./task-store'), runAudioEditTask: async (_id: string, _kind: string, work: (signal: AbortSignal, progress: (value: number) => void) => Promise<unknown>) => work(new AbortController().signal, () => {}) }))
// 试听：浮点副本“还在转”时走原素材解码；测试用真实转码结果作对照
vi.mock('./media', async () => {
  const actual = await vi.importActual<typeof import('./media')>('./media')
  return { ...actual, prepareAudioEditAudio: (project: AudioEditProjectDocument) => state.pending ? new Promise(() => {}) : actual.prepareAudioEditAudio(project) }
})
vi.mock('./processors', () => ({ listAudioEditProcessors: async () => [] }))
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { runAudioEditProcess } from './process'
import { openF32Wav } from './pcm-wav'
import { prepareAudioEditPreviewChunk, resetAudioEditPreviewForTests } from './preview'

let media: typeof import('./media')
beforeAll(async () => {
  media = await vi.importActual<typeof import('./media')>('./media')
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-media-ffmpeg-'))
})
afterAll(async () => { resetAudioEditPreviewForTests(); await fs.rm(state.root, { recursive: true, force: true }) })

async function decodedFrames(file: string): Promise<number> {
  let frames = 0
  await runAudioEditProcess(await loadFfprobePath(), ['-v', 'error', '-select_streams', 'a:0', '-show_frames', '-show_entries', 'frame=nb_samples', '-of', 'csv=p=0', file], undefined, undefined, line => { frames += Number(line.split(',')[0]) || 0 })
  return frames
}

it.each([
  ['mp4（AAC + 视频，帧数取自容器，等副本）', 'take.mp4', ['-f', 'lavfi', '-i', 'testsrc=d=6.3:s=160x120:r=25', '-c:v', 'libx264', '-g', '25', '-c:a', 'aac', '-b:a', '128k', '-shortest'], 48000, false],
  ['WAV（16 位 PCM）', 'take.wav', ['-c:a', 'pcm_s16le'], 44100, true],
  ['FLAC', 'take.flac', ['-c:a', 'flac'], 48000, true],
  ['mp3（编码延迟，解码计数，等副本）', 'take.mp3', ['-c:a', 'libmp3lame', '-b:a', '128k'], 44100, false],
] as const)('%s：探测帧数与逐帧解码一致；副本转好之前从原素材解码的块与副本逐样本相同', async (_name, name, encode, rate, fallback) => {
  const file = path.join(state.root, name)
  // 噪声而不是正弦：采样值不重复，错开一个样本也比得出来
  await runAudioEditProcess(await loadFfmpegPath(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', `anoisesrc=d=6.3:r=${rate}:a=0.3:seed=7`, ...encode, file])
  const source = await media.probeAudioEditSource(file)
  expect(source.durationFrames).toBe(await decodedFrames(file))
  state.project = { id: `ffmpeg-${name.replace('.', '-')}`, name, revision: 1, createdAt: 0, updatedAt: 0, referenceScript: '', transcript: [], suggestions: [], source } as AudioEditProjectDocument
  // 副本还在转：PCM / FLAC 预卷一秒后按样本时间戳裁出的块；压缩音频不走这条路，等副本（这里直接给副本）
  state.pending = fallback
  const chunks = await Promise.all([0, rate * 2 + 1234, source.durationFrames - 3000].map(start => prepareAudioEditPreviewChunk({ projectId: state.project!.id, mode: 'source', sourceStartFrame: start, frameCount: rate })))
  // 真实转码出来的副本
  state.pending = false
  const copy = (await openF32Wav(await media.prepareAudioEditAudio(state.project)))!
  try {
    expect(copy.frames).toBe(source.durationFrames)
    for (const chunk of chunks) {
      const expected = await copy.read(chunk.sourceStartFrame, chunk.sourceEndFrame - chunk.sourceStartFrame)
      expect(chunk.sourceEndFrame - chunk.sourceStartFrame).toBe(Math.min(rate, source.durationFrames - chunk.sourceStartFrame))
      expect(Buffer.from(chunk.pcm).equals(Buffer.from(expected.buffer))).toBe(true)
    }
  } finally { await copy.close() }
})
