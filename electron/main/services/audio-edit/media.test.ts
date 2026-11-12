import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }) }))
vi.mock('../db', () => ({ getDb: vi.fn() }))
vi.mock('../appPaths', () => ({ getProgramStoreDir: () => `${os.tmpdir()}/AudioEdit` }))
vi.mock('../media/shared', () => ({ resolveLocalMediaPath: async (value: string) => value }))
vi.mock('../media/media-cache-runtime', () => ({ getMediaCacheManager: () => ({ categoryDirectory: (_category: string, id: string) => path.join(directory ?? os.tmpdir(), '.痕迹AI缓存', 'audio-edit', id) }) }))
vi.mock('./project-store', () => ({ requireAudioEditProject: vi.fn() }))
const tasks = vi.hoisted(() => ({ prepare: 0 }))
vi.mock('./task-store', async () => {
  const actual = await vi.importActual<typeof import('./task-store')>('./task-store')
  // 回执表在数据库里；这里只记下后台准备任务并照常执行
  return { ...actual, runAudioEditTask: async (_id: string, kind: string, work: (signal: AbortSignal, progress: (value: number) => void) => Promise<unknown>) => { if (kind === 'prepare') tasks.prepare++; return work(new AbortController().signal, () => {}) } }
})
import { audioEditCacheDirectory, probeAudioEditImport, prepareAudioEditAudio, relinkAudioEditSource } from './media'
import { requireAudioEditProject } from './project-store'
import { digestWholeAudioEditSource } from './source-identity'
import { audioEditProjectSchema } from '../../../../src/core/audioEdit/schema'
import { cancelAudioEditTask, hasActiveAudioEditTask } from './task-store'
import { runAudioEditProcess } from './process'
vi.mock('../video/ffmpeg-loader', () => ({ loadFfprobePath: async () => 'ffprobe', loadFfmpegPath: async () => 'ffmpeg' }))
vi.mock('./process', () => ({ runAudioEditProcess: vi.fn() }))

let directory: string | undefined
afterEach(async () => { vi.mocked(runAudioEditProcess).mockReset(); if (directory) await fs.rm(directory, { recursive: true, force: true }); directory = undefined })

it('同时取原素材浮点副本的几方共用一次后台转码，帧数对齐到作品长度', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-source-decode-'))
  const file = path.join(directory, 'source.wav'); await fs.writeFile(file, 'source')
  const project = { id: 'decode', source: { ownership: 'external', sourcePath: file, audioPath: file, sampleRate: 48000, channels: 2, durationFrames: 48000 } } as AudioEditProjectDocument
  let decodes = 0
  vi.mocked(runAudioEditProcess).mockImplementation(async (binary, args) => {
    if (binary === 'ffprobe') return JSON.stringify({ streams: [{ sample_rate: '48000', channels: 2, duration: '1' }] })
    decodes++
    expect(args).toEqual(expect.arrayContaining(['pcm_f32le', 'asetpts=N/SR/TB,atrim=end_sample=48000,apad=whole_len=48000']))
    await fs.writeFile(args.at(-1)!, 'float PCM'); return ''
  })
  tasks.prepare = 0
  const [first, second] = await Promise.all([prepareAudioEditAudio(project), prepareAudioEditAudio(project)])
  expect(first).toBe(second); expect(decodes).toBe(1); expect(tasks.prepare).toBe(1)
  expect(await prepareAudioEditAudio(project)).toBe(first); expect(decodes).toBe(1)
})

it('rejects cache traversal before filesystem deletion is possible', () => {
  expect(() => audioEditCacheDirectory('../original')).toThrow('无效')
  expect(() => audioEditCacheDirectory('C:\\original')).toThrow('无效')
  // 口播缓存随作品目录下的统一缓存根（缓存与代理改造），不再放程序目录。
  expect(audioEditCacheDirectory('safe-project')).toBe(path.join(os.tmpdir(), '.痕迹AI缓存', 'audio-edit', 'safe-project'))
})

/** 一份 ffprobe 替身：按参数回答文件头、逐帧解码计数与视频包时间戳，并记下调用了哪些整段扫描。 */
function fakeProbe(header: unknown, packets: (args: string[]) => string[] = () => []): string[][] {
  const calls: string[][] = []
  vi.mocked(runAudioEditProcess).mockImplementation(async (_binary, args, _signal, _onLine, onOutputLine) => {
    calls.push(args)
    if (args.includes('-show_streams')) return JSON.stringify(header)
    if (args.includes('-show_frames')) { onOutputLine?.('1152'); onOutputLine?.('1152') }
    else for (const line of packets(args)) onOutputLine?.(line)
    return ''
  })
  return calls
}

it('导入 WAV 只读文件头与采样块：帧数取自容器，不整段解码、不整文件哈希', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-probe-wav-'))
  const file = path.join(directory, '口播.wav')
  await fs.writeFile(file, Buffer.alloc(32 * 1024 * 1024, 1))
  const calls = fakeProbe({ format: { format_name: 'wav', duration: '3600' }, streams: [{ index: 0, codec_type: 'audio', codec_name: 'pcm_s16le', sample_rate: '48000', channels: 2, time_base: '1/48000', duration_ts: 172_800_000, duration: '3600' }] })
  const source = await probeAudioEditImport(file, 'probe-wav')
  expect(source).toMatchObject({ durationFrames: 172_800_000, sampleRate: 48000, channels: 2, mediaType: 'audio', ownership: 'external', fingerprint: { size: 32 * 1024 * 1024 } })
  expect(source.identity).toBeUndefined()
  expect(calls).toHaveLength(1)
})

it('导入长视频：帧数取自 mp4 时间表，视频时间戳只抽查开头、正中、结尾三个窗口', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-probe-mp4-'))
  const file = path.join(directory, '口播.mp4')
  await fs.writeFile(file, Buffer.alloc(1024))
  const windows = [0, 1795, 3590]
  const calls = fakeProbe({ format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '3600' }, streams: [
    { index: 0, codec_type: 'video', r_frame_rate: '25/1', avg_frame_rate: '25/1', duration: '3600', width: 1920, height: 1080 },
    { index: 1, codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, time_base: '1/48000', duration_ts: 172_800_000, duration: '3600' },
  ] }, () => windows.flatMap(start => Array.from({ length: 250 }, (_, frame) => `${(start + frame / 25).toFixed(6)},0.040000`)))
  const source = await probeAudioEditImport(file, 'probe-mp4')
  expect(source).toMatchObject({ durationFrames: 172_800_000, audioStreamIndex: 1, video: { variableFrameRate: false } })
  expect(calls.some(args => args.includes('-show_frames'))).toBe(false)
  const packets = calls.find(args => args.includes('packet=pts_time,duration_time'))!
  expect(packets[packets.indexOf('-read_intervals') + 1]).toBe('0.000%+10,1795.000%+10,3590.000%+10')
})

it('抽查窗口里缺了一帧就判为时间戳不稳定', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-probe-vfr-'))
  const file = path.join(directory, '口播.mp4')
  await fs.writeFile(file, Buffer.alloc(1024))
  fakeProbe({ format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '3600' }, streams: [
    { index: 0, codec_type: 'video', r_frame_rate: '25/1', avg_frame_rate: '25/1', duration: '3600' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, time_base: '1/48000', duration_ts: 172_800_000, duration: '3600' },
  ] }, () => [0, 1795, 3590].flatMap(start => Array.from({ length: 250 }, (_, frame) => frame).filter(frame => start !== 1795 || frame !== 100).map(frame => `${(start + frame / 25).toFixed(6)},0.040000`)))
  expect((await probeAudioEditImport(file, 'probe-vfr')).video?.variableFrameRate).toBe(true)
})

it('mp3 这类容器帧数不精确的格式仍解码计数；探测登记取消，各路扫描都接收取消信号', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-probe-cancel-'))
  const file = path.join(directory, '素材.mp3')
  await fs.writeFile(file, Buffer.alloc(16 * 1024 * 1024))
  const process = vi.mocked(runAudioEditProcess)
  process.mockImplementation(async (_binary, args, signal, _onLine, onOutputLine, idleTimeout) => {
    expect(hasActiveAudioEditTask('probe-request')).toBe(true)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(idleTimeout).toBe(30_000)
    if (args.includes('-show_streams')) return JSON.stringify({ format: { format_name: 'mp3', duration: '1' }, streams: [{ index: 0, codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100', time_base: '1/14112000', duration_ts: 14_112_000, duration: '1' }] })
    expect(args).toContain('-show_frames')
    onOutputLine?.('1152'); setImmediate(() => cancelAudioEditTask('probe-request'))
    return ''
  })
  await expect(probeAudioEditImport(file, 'probe-request')).rejects.toMatchObject({ name: 'AbortError' })
  expect(process).toHaveBeenCalledTimes(2)
  expect(hasActiveAudioEditTask('probe-request')).toBe(false)
})

it('后台转码不随某个调用方取消：取消的一方自己停止等待，转好的副本照常发布给还在等的一方，不重转', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-source-cancel-'))
  const file = path.join(directory, 'source.wav'); await fs.writeFile(file, 'source')
  const project = { id: 'cancel', source: { ownership: 'external', sourcePath: file, audioPath: file, sampleRate: 48000, channels: 2, durationFrames: 48000 } } as AudioEditProjectDocument
  let decodes = 0
  let release!: () => void
  const finished = new Promise<void>(resolve => { release = resolve })
  vi.mocked(runAudioEditProcess).mockImplementation(async (binary, args) => {
    if (binary === 'ffprobe') return JSON.stringify({ streams: [{ sample_rate: '48000', channels: 2, duration: '1' }] })
    decodes++; await finished; await fs.writeFile(args.at(-1)!, 'float PCM'); return ''
  })
  const transcription = new AbortController()
  const first = prepareAudioEditAudio(project, transcription.signal)
  const preview = prepareAudioEditAudio(project)
  await vi.waitFor(() => expect(decodes).toBe(1))
  transcription.abort()
  await expect(first).rejects.toBeDefined()
  release()
  const copy = await preview
  expect(await fs.readFile(copy, 'utf8')).toBe('float PCM')
  expect(await prepareAudioEditAudio(project)).toBe(copy)
  expect(decodes).toBe(1)
})

it('起点时间戳很大的视频（TS/MTS）按流起点抽查；抽查读不到包时不标不稳定，留给导出前的整段检查', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-probe-ts-'))
  const file = path.join(directory, '口播.mts')
  await fs.writeFile(file, Buffer.alloc(1024))
  const header = (start: string) => ({ format: { format_name: 'mpegts', duration: '3600' }, streams: [
    { index: 0, codec_type: 'video', r_frame_rate: '25/1', avg_frame_rate: '25/1', duration: '3600', start_time: start },
    { index: 1, codec_type: 'audio', codec_name: 'pcm_s16be', sample_rate: '48000', channels: 2, time_base: '1/48000', duration_ts: 172_800_000, duration: '3600', start_time: start },
  ] })
  const calls = fakeProbe(header('5000.000000'), () => [5000, 6795, 8590].flatMap(start => Array.from({ length: 250 }, (_, frame) => `${(start + frame / 25).toFixed(6)},0.040000`)))
  expect((await probeAudioEditImport(file, 'probe-ts')).video?.variableFrameRate).toBe(false)
  const packets = calls.find(args => args.includes('packet=pts_time,duration_time'))!
  expect(packets[packets.indexOf('-read_intervals') + 1]).toBe('5000.000%+10,6795.000%+10,8590.000%+10')
  // 结尾那个窗口一个包都没读到：答不上来，不标不稳定
  fakeProbe(header('5000.000000'), () => [5000, 6795].flatMap(start => Array.from({ length: 250 }, (_, frame) => `${(start + frame / 25).toFixed(6)},0.040000`)))
  expect((await probeAudioEditImport(file, 'probe-ts-unknown')).video?.variableFrameRate).toBe(false)
})

it('带整文件摘要的旧作品重新定位：整文件比对相同后同时带 identity 与 fingerprint，保留原帧数，作品结构照常通过', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-relink-'))
  const original = path.join(directory, '原素材.wav'), moved = path.join(directory, '移动后.wav')
  await fs.writeFile(original, Buffer.alloc(4096, 3))
  const identity = await digestWholeAudioEditSource(original)
  await fs.rename(original, moved)
  const project = { id: 'relink', name: '旧作品', revision: 3, createdAt: 0, updatedAt: 0, referenceScript: '', transcript: [], suggestions: [],
    source: { mediaType: 'audio', sourcePath: original, audioPath: original, ownership: 'external', sampleRate: 48000, channels: 2, durationFrames: 47_999, audioStreamIndex: 0, identity } } as AudioEditProjectDocument
  vi.mocked(requireAudioEditProject).mockResolvedValue(project)
  fakeProbe({ format: { format_name: 'wav', duration: '1' }, streams: [{ index: 0, codec_type: 'audio', codec_name: 'pcm_s16le', sample_rate: '48000', channels: 2, time_base: '1/48000', duration_ts: 48_000, duration: '1' }] })
  const source = await relinkAudioEditSource('relink', moved)
  expect(source).toMatchObject({ sourcePath: moved, durationFrames: 47_999, identity: { digest: identity.digest }, fingerprint: { digest: expect.stringMatching(/^[a-f0-9]{64}$/) } })
  expect(audioEditProjectSchema.safeParse({ ...project, source }).success).toBe(true)
})
