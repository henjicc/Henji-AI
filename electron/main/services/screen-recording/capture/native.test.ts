import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { captureOptionsSchema, type CaptureManifest } from '../../../../../src/core/screenRecording/capture'
import type { ScreenCaptureEvent } from './native-client'

vi.mock('../../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
vi.mock('../../video/ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg', loadFfprobePath: async () => 'ffprobe' }))
vi.mock('../../video/proxy-runtime', () => ({ adoptRecordedVideoProxy: vi.fn() }))
vi.mock('./storage', async importOriginal => ({ ...await importOriginal<typeof import('./storage')>(), probeMediaDurationUs: vi.fn(async () => 6_000_000) }))
import { NativeCaptureBackend } from './native'
import { CaptureStorage } from './storage'
import { CELL, pausedRecording } from './native-timing.test-support'

/** 时钟偏移：采集进程时钟 + 1000 = 主进程时钟。 */
const OFFSET = 1000
/** 帧的系统时刻比画面内容晚这么多（采集程序在准备时报的）。 */
const LEAD = 20_000
class FakeClient {
  requests: Array<{ type: string; payload: Record<string, unknown> }> = []
  listener: ((event: ScreenCaptureEvent) => void) | undefined
  lost: ((loss: { code: string; message: string }) => void) | undefined
  size = { width: 1920, height: 1080 }
  result = { frames: 180, encodedFrames: 179, durationUs: 6e6, originUs: 10_000_000, freshFrames: 179, repeatedFrames: 0, droppedFrames: 1, captureDropped: 0, bytes: 1, durableFrames: 180, files: { video: '', timing: '', activity: '', manifest: '' } }
  onRequest: (type: string, payload: Record<string, unknown>) => void = () => undefined
  active = vi.fn()
  async request(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    this.requests.push({ type, payload })
    setTimeout(() => this.onRequest(type, payload))
    if (type === 'prepare') return { sessionId: payload.sessionId, ...this.size, fps: 30, codec: 'h264', encoder: 'h264_nvenc', proxy: { width: 960, height: 540 }, presentLeadUs: LEAD, files: this.result.files }
    if (type === 'stop') return this.result
    return {}
  }
  subscribe(_id: string, listener: (event: ScreenCaptureEvent) => void, lost: (loss: { code: string; message: string }) => void): () => void { this.listener = listener; this.lost = lost; return () => { this.listener = undefined } }
  /** 时钟校准的抖动：两次换算之间估出的偏移会差几毫秒。 */
  drift = 0
  toMainUs(nativeUs: number): number { return nativeUs + OFFSET + this.drift }
  toNativeUs(mainUs: number): number { return mainUs - OFFSET - this.drift }
  setActive = this.active
  emit(event: Record<string, unknown>): void { this.listener?.({ sessionId: 's', ...event } as ScreenCaptureEvent) }
}

let directory: string, storage: CaptureStorage, client: FakeClient, now: number
const deps = { failed: vi.fn(), sourceEnded: vi.fn(), adoptProxy: vi.fn(async () => undefined) }
const options = captureOptionsSchema.parse({ sourceId: 'screen:0:0', width: 1920, height: 1080, fps: 30, bitrate: 12_000_000 })
const signal = new AbortController().signal
function backend(): NativeCaptureBackend {
  return new NativeCaptureBackend(options, [960, 540], storage, { client, originUs: 1_000_000, nowUs: () => now, ...deps })
}
beforeEach(async () => {
  vi.clearAllMocks()
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-capture-'))
  const manifest: CaptureManifest = { version: 2, minReaderVersion: 1, sessionId: randomUUID(), options, backend: 'gfxcapture', cursorEmbedded: false, status: 'prepared', spans: [] }
  storage = new CaptureStorage(directory, manifest); await storage.prepare()
  client = new FakeClient(); now = 12_000_000
  client.onRequest = type => { if (type === 'start') client.emit({ event: 'started', originUs: 10_000_000, firstSourceUs: 9_990_000 }) }
})
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })

it('一次录制一个画面分片：文件名与分片一致；起点、暂停、继续都记画面内容的时刻（采集进程按格给的时刻减去上屏提前量）；停止按时刻表把起点定准', async () => {
  const capture = backend()
  await capture.prepare()
  expect(client.requests[0]).toMatchObject({ type: 'prepare', payload: { name: 'screen-000000', directory, source: { kind: 'display', point: [960, 540] }, fps: 30, codec: 'h264', proxy: { height: 540 } } })
  await capture.start(signal)
  expect(storage.manifest.spans).toEqual([expect.objectContaining({ index: 0, file: 'screen-000000.mp4', monoUs: 10_000_000 + OFFSET - LEAD - 1_000_000, finalized: false })])
  expect(storage.manifest.encoding).toEqual({ codec: 'h264', encoder: 'h264_nvenc', softwareFallback: false })
  expect(capture.capturingSinceUs()).toBe(10_000_000 + OFFSET - LEAD)

  // 按下暂停在 13 秒（主进程时钟）；网格从第 90 格暂停，第 150 格继续。
  client.onRequest = type => {
    if (type === 'pause') client.emit({ event: 'paused', atUs: 10_000_000 + 90 * CELL, cell: 90, frame: 90, reason: 'user' })
    if (type === 'resume') client.emit({ event: 'resumed', atUs: 10_000_000 + 150 * CELL, cell: 150, frame: 90 })
  }
  // 要内容切在按下那一刻，采集进程该切的帧时刻晚一个提前量；返回的是它真正切下的那一格，不是按下的时刻。
  await expect(capture.hold(13_000_000)).resolves.toBeCloseTo(10_000_000 + 90 * CELL + OFFSET - LEAD, 0)
  expect(client.requests.at(-1)).toEqual({ type: 'pause', payload: expect.objectContaining({ atUs: 13_000_000 + LEAD - OFFSET }) })
  expect(capture.capturingSinceUs()).toBeUndefined()
  now = 13_400_000
  await capture.pause(signal)
  expect(client.requests.filter(request => request.type === 'pause')).toHaveLength(1)
  now = 15_100_000
  // 暂停期间时钟校准变了 7 毫秒：继续的时刻按两格之差接着走，暂停长度仍是整 60 格，不跟着偏。
  client.drift = 7000
  // 事件采集先要画面续上、各路一起续的那条路同时也来调：只向采集进程发一次。
  const [since] = await Promise.all([capture.unhold(), capture.resume(signal)])
  expect(since).toBeCloseTo(10_000_000 + 150 * CELL + OFFSET - LEAD, 0)
  expect(client.requests.filter(request => request.type === 'resume')).toEqual([{ type: 'resume', payload: expect.objectContaining({ atUs: 15_100_000 + LEAD - OFFSET - 7000 }) }])
  expect(capture.capturingSinceUs()).toBeCloseTo(10_000_000 + 150 * CELL + OFFSET - LEAD, 0)
  client.drift = 0

  await fs.writeFile(path.join(directory, 'screen-000000.frames'), pausedRecording())
  await capture.stop(signal)
  // 时刻表里每帧比格晚 5 毫秒上屏：起点往后挪 5 毫秒；时长是文件时间轴的 180 帧。
  expect(storage.manifest.spans[0]).toMatchObject({ monoUs: 10_000_000 + 5000 + OFFSET - LEAD - 1_000_000, durationUs: 6_000_000, finalized: true })
  // 原生同时录的代理按原片登记给剪辑（尺寸是剪辑 auto 档）。
  expect(deps.adoptProxy).toHaveBeenCalledWith(path.join(directory, 'screen-000000.mp4'), path.join(directory, 'screen-000000.proxy.mp4'), { width: 960, height: 540 })
  expect(capture.stats()).toEqual({ restarts: 0, droppedFrames: 1, duplicatedFrames: 0, encoder: 'h264_nvenc' })
  await capture.cancel()
  expect(client.requests.filter(request => request.type === 'stop')).toHaveLength(1)
})

it('采集进程没报出暂停与继续生效的那一格：暂停记在按下的时刻，事件时钟不扣时间', async () => {
  const capture = backend()
  await capture.prepare(); await capture.start(signal)
  await expect(capture.hold(13_000_000)).resolves.toBe(13_000_000)
  now = 13_010_000
  await capture.resume(signal)
  expect(capture.capturingSinceUs()).toBe(13_000_000)
})

it('取消在开始之前只放掉采集；开始之后按停止收尾、保留已录画面，不让原生删文件', async () => {
  const idle = backend()
  await idle.prepare(); await idle.cancel()
  expect(client.requests.map(request => request.type)).toEqual(['prepare', 'cancel'])
  expect(client.active).toHaveBeenLastCalledWith(false)

  client.requests = []
  const recording = backend()
  await recording.prepare(); await recording.start(signal); await recording.cancel()
  expect(client.requests.map(request => request.type)).toEqual(['prepare', 'start', 'stop'])
  expect(storage.manifest.spans[0].finalized).toBe(true)
})

it('来源丢着时报出画面从哪一刻起没有的，接回后不再报：录制若就此结束，会话到那一刻为止', async () => {
  const capture = backend()
  await capture.prepare(); await capture.start(signal)
  expect(capture.sourceLostSinceUs()).toBeUndefined()
  client.emit({ event: 'sourceLost', atUs: 14_000_000 })
  expect(capture.sourceLostSinceUs()).toBe(14_000_000 + OFFSET - LEAD)
  client.emit({ event: 'sourceRestored', atUs: 15_000_000 })
  expect(capture.sourceLostSinceUs()).toBeUndefined()
  // 暂停在先、来源后丢：画面在暂停那一刻就没有了。
  await capture.hold(16_000_000)
  client.emit({ event: 'sourceLost', atUs: 17_000_000 })
  expect(capture.sourceLostSinceUs()).toBe(16_000_000)
  await capture.stop(signal)
})

it('显示器实际尺寸与录制尺寸不同：准备阶段放掉采集并报不支持，由调用方改用现有录法', async () => {
  client.size = { width: 3840, height: 2160 }
  await expect(backend().prepare()).rejects.toMatchObject({ code: 'CAPTURE_UNSUPPORTED' })
  expect(client.requests.map(request => request.type)).toEqual(['prepare', 'cancel'])
})

it('录制中显示器断开按来源结束收尾；进程失联按采集失败，分片留给恢复按文件补齐', async () => {
  const capture = backend()
  await capture.prepare(); await capture.start(signal)
  client.emit({ event: 'interrupted', error: { code: 'SOURCE_LOST', message: '显示器断开', recoverable: true }, ...client.result, frames: 30 })
  await vi.waitFor(() => expect(deps.sourceEnded).toHaveBeenCalledTimes(1))
  expect(storage.manifest.spans[0]).toMatchObject({ durationUs: 1_000_000, finalized: true })
  await capture.stop(signal)
  expect(client.requests.some(request => request.type === 'stop')).toBe(false)
  expect(deps.failed).not.toHaveBeenCalled()

  storage.manifest.spans.length = 0
  const crashed = backend()
  await crashed.prepare(); await crashed.start(signal)
  client.lost!({ code: 'PROCESS_EXITED', message: '画面采集服务异常退出' })
  expect(deps.failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'PROCESS_EXITED' }))
  expect(storage.manifest.spans[0].finalized).toBe(false)
  await crashed.cancel()
  expect(client.requests.filter(request => request.type === 'stop')).toHaveLength(0)
})
