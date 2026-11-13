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
  /** 接下来这么多次准备都失败（显卡刚重置完设备还建不起来）。 */
  prepareFailures = 0
  rejectStart = false
  /** 下一次暂停的请求被拒之前先调它（模拟进程在请求途中退出）。 */
  rejectPause: (() => void) | undefined
  async request(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    this.requests.push({ type, payload })
    if (type === 'prepare' && this.prepareFailures-- > 0) throw Object.assign(new Error('设备还没准备好'), { code: 'CAPTURE_FAILED' })
    if (type === 'start' && this.rejectStart) throw Object.assign(new Error('录制已经开始'), { code: 'INVALID_STATE' })
    if (type === 'pause' && this.rejectPause) { this.rejectPause(); throw Object.assign(new Error('画面采集服务已退出'), { code: 'PROCESS_EXITED' }) }
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
const deps = { failed: vi.fn(), sourceEnded: vi.fn(), adoptProxy: vi.fn(async () => undefined), restarted: vi.fn(), sleep: vi.fn(async (_ms: number): Promise<void> => undefined) }
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

it('代理中途被停掉（比原片短）：不登记给剪辑，半截的代理文件删掉；停摆造成的空档不当成这次暂停生效的那一格', async () => {
  const capture = backend()
  await capture.prepare(); await capture.start(signal)
  client.onRequest = type => { if (type === 'pause') client.emit({ event: 'paused', atUs: 12_500_000, cell: 75, frame: 75, reason: 'stall' }) }
  await expect(capture.hold(13_000_000)).resolves.toBe(13_000_000)
  client.emit({ event: 'proxyStopped', reason: 'overload', frame: 80 })
  const proxy = path.join(directory, 'screen-000000.proxy.mp4')
  await fs.writeFile(proxy, 'half')
  client.result = { ...client.result, proxyFrames: 80 } as typeof client.result
  await capture.stop(signal)
  expect(deps.adoptProxy).not.toHaveBeenCalled()
  await expect(fs.stat(proxy)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(storage.manifest.spans[0].finalized).toBe(true)
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

const interruptedEvent = (code: string, frames: number): Record<string, unknown> => ({ event: 'interrupted', error: { code, message: '显卡设备已重置', recoverable: true }, ...client.result, frames })
const requestTypes = (): string[] => client.requests.map(request => request.type)

it('显卡设备丢失：中断的分片按文件里真有的画面收好，同一次录制另开一个分片接着录；之后的暂停、继续、停止都作用在新分片上', async () => {
  const capture = backend()
  await capture.prepare(); await capture.start(signal)
  // 新分片的网格起点在 20 秒；设备刚重置完，头一次准备还起不来。
  client.onRequest = type => { if (type === 'start') client.emit({ event: 'started', originUs: 20_000_000, firstSourceUs: 20_000_000 }) }
  client.prepareFailures = 1
  // 事件说出了 240 格，文件里实际只读得回 6 秒（探测结果）：以文件为准。
  client.emit(interruptedEvent('DEVICE_REMOVED', 240))
  expect(capture.capturingSinceUs()).toBeUndefined()
  // 续录还没完成时按下暂停：等新分片开好再暂停，暂停的是新分片。
  client.onRequest = type => {
    if (type === 'start') client.emit({ event: 'started', originUs: 20_000_000, firstSourceUs: 20_000_000 })
    if (type === 'pause') client.emit({ event: 'paused', atUs: 21_000_000, cell: 30, frame: 30, reason: 'user' })
  }
  await expect(capture.hold(21_000_000)).resolves.toBe(21_000_000 + OFFSET - LEAD)
  expect(requestTypes()).toEqual(['prepare', 'start', 'prepare', 'prepare', 'start', 'pause'])
  expect(client.requests[3]).toMatchObject({ type: 'prepare', payload: { name: 'screen-000001' } })
  expect(deps.sleep).toHaveBeenCalledWith(500)
  expect(deps.restarted).toHaveBeenCalledWith(expect.objectContaining({ restarts: 1 }))
  expect(deps.failed).not.toHaveBeenCalled()
  expect(storage.manifest.spans).toEqual([
    expect.objectContaining({ file: 'screen-000000.mp4', durationUs: 6_000_000, finalized: true }),
    expect.objectContaining({ file: 'screen-000001.mp4', monoUs: 20_000_000 + OFFSET - LEAD - 1_000_000, finalized: false }),
  ])
  await capture.stop(signal)
  expect(storage.manifest.spans[1]).toMatchObject({ durationUs: 6_000_000, finalized: true })
  // 丢帧与重复帧把两个分片的加在一起。
  expect(capture.stats()).toEqual({ restarts: 1, droppedFrames: 2, duplicatedFrames: 0, encoder: 'h264_nvenc' })
})

it('暂停期间采集中断：只收好中断的分片，按下继续才开新分片；一直没继续就停止时不向采集进程发停止', async () => {
  const capture = backend()
  await capture.prepare(); await capture.start(signal)
  client.onRequest = type => { if (type === 'pause') client.emit({ event: 'paused', atUs: 12_000_000, cell: 60, frame: 60, reason: 'user' }) }
  await capture.hold(13_000_000)
  client.emit(interruptedEvent('DEVICE_REMOVED', 60))
  await vi.waitFor(() => expect(storage.manifest.spans[0].finalized).toBe(true))
  expect(requestTypes()).toEqual(['prepare', 'start', 'pause'])
  client.onRequest = type => { if (type === 'start') client.emit({ event: 'started', originUs: 30_000_000, firstSourceUs: 30_000_000 }) }
  now = 30_000_000
  await expect(capture.unhold()).resolves.toBe(30_000_000 + OFFSET - LEAD)
  expect(requestTypes()).toEqual(['prepare', 'start', 'pause', 'prepare', 'start'])
  expect(capture.capturingSinceUs()).toBe(30_000_000 + OFFSET - LEAD)
  expect(storage.manifest.spans).toHaveLength(2)
  await capture.stop(signal)

  storage.manifest.spans.length = 0; client.requests = []
  client.onRequest = type => {
    if (type === 'start') client.emit({ event: 'started', originUs: 10_000_000, firstSourceUs: 9_990_000 })
    if (type === 'pause') client.emit({ event: 'paused', atUs: 12_000_000, cell: 60, frame: 60, reason: 'user' })
  }
  const stopped = backend()
  await stopped.prepare(); await stopped.start(signal); await stopped.hold(13_000_000)
  client.emit(interruptedEvent('ENCODER_FAILED', 60))
  await stopped.stop(signal)
  expect(requestTypes()).toEqual(['prepare', 'start', 'pause'])
  expect(storage.manifest.spans).toEqual([expect.objectContaining({ durationUs: 2_000_000, finalized: true })])
  expect(deps.failed).not.toHaveBeenCalled()
})

it('继续已经按下、还没续上时中断：照常开新分片接着录，不当成暂停着；续录途中按停止：不再开新分片，按正常停止收尾', async () => {
  const capture = backend()
  await capture.prepare(); await capture.start(signal)
  client.onRequest = type => {
    if (type === 'start') client.emit({ event: 'started', originUs: 30_000_000, firstSourceUs: 30_000_000 })
    if (type === 'pause') client.emit({ event: 'paused', atUs: 12_000_000, cell: 60, frame: 60, reason: 'user' })
    // 继续发出去了，采集进程没报续上，报的是中断。
    if (type === 'resume') client.emit(interruptedEvent('DEVICE_REMOVED', 60))
  }
  await capture.hold(13_000_000)
  // 继续返回的是新分片的起点：事件时钟从那里接着走，暂停算到那一刻为止，与会话文档记的一致。
  await expect(capture.unhold()).resolves.toBe(30_000_000 + OFFSET - LEAD)
  expect(capture.capturingSinceUs()).toBe(30_000_000 + OFFSET - LEAD)
  expect(requestTypes()).toEqual(['prepare', 'start', 'pause', 'resume', 'prepare', 'start'])
  expect(deps.failed).not.toHaveBeenCalled()

  // 暂停的请求还没应答进程就退出了：等新分片开好，在新分片上暂停。
  client.requests = []
  client.onRequest = type => {
    if (type === 'start') client.emit({ event: 'started', originUs: 40_000_000, firstSourceUs: 40_000_000 })
    if (type === 'pause') client.emit({ event: 'paused', atUs: 40_500_000, cell: 15, frame: 15, reason: 'user' })
  }
  client.rejectPause = () => { client.rejectPause = undefined; client.lost!({ code: 'PROCESS_EXITED', message: '画面采集服务异常退出' }) }
  await expect(capture.hold(40_400_000)).resolves.toBe(40_500_000 + OFFSET - LEAD)
  expect(requestTypes()).toEqual(['pause', 'prepare', 'start', 'pause'])
  client.onRequest = type => {
    if (type === 'start') client.emit({ event: 'started', originUs: 50_000_000, firstSourceUs: 50_000_000 })
    if (type === 'resume') client.emit({ event: 'resumed', atUs: 41_500_000, cell: 45, frame: 15 })
  }
  await expect(capture.unhold()).resolves.toBe(41_500_000 + OFFSET - LEAD)
  expect(deps.failed).not.toHaveBeenCalled()

  // 再中断一次：设备一时起不来，等着重试的时候用户按了停止。
  let wake = (): void => undefined
  deps.sleep.mockImplementationOnce(() => new Promise<void>(resolve => { wake = () => resolve() }))
  client.prepareFailures = 1; client.requests = []
  client.emit(interruptedEvent('DEVICE_REMOVED', 30))
  await vi.waitFor(() => expect(deps.sleep).toHaveBeenCalled())
  const stopping = capture.stop(signal)
  wake()
  await stopping
  expect(requestTypes()).toEqual(['prepare'])
  expect(deps.failed).not.toHaveBeenCalled()
  // 第二个分片是进程退出时留下的（不封口，留给收尾按文件补齐），其余两个都收好了。
  expect(storage.manifest.spans.map(span => span.finalized)).toEqual([true, false, true])
})

it('新分片准备好了却没能开始（开始被拒）：让采集进程把它停掉，再按采集失败结束', async () => {
  const capture = backend()
  await capture.prepare(); await capture.start(signal)
  client.rejectStart = true
  client.emit(interruptedEvent('DEVICE_REMOVED', 30))
  await vi.waitFor(() => expect(deps.failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_STATE' })))
  expect(requestTypes()).toEqual(['prepare', 'start', 'prepare', 'start', 'stop'])
})

it('中断后一直开不起来：按采集失败结束，已录分片保留；磁盘写满这类重开也没用的不重试', async () => {
  const capture = backend()
  await capture.prepare(); await capture.start(signal)
  client.prepareFailures = 10
  client.emit(interruptedEvent('DEVICE_REMOVED', 30))
  await vi.waitFor(() => expect(deps.failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'CAPTURE_FAILED' })))
  expect(requestTypes().filter(type => type === 'prepare')).toHaveLength(5)
  expect(storage.manifest.spans).toEqual([expect.objectContaining({ durationUs: 1_000_000, finalized: true })])
  await capture.stop(signal)
  expect(requestTypes()).not.toContain('stop')

  storage.manifest.spans.length = 0; client.requests = []; client.prepareFailures = 0; deps.failed.mockClear()
  const full = backend()
  await full.prepare(); await full.start(signal)
  client.emit(interruptedEvent('DISK_FULL', 30))
  await vi.waitFor(() => expect(deps.failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'DISK_FULL' })))
  expect(requestTypes()).toEqual(['prepare', 'start'])
})

it('录制中显示器断开按来源结束收尾；采集进程退出时原分片留给恢复按文件补齐，重新启动的进程在新分片里接着录', async () => {
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
  client.requests = []
  client.lost!({ code: 'PROCESS_EXITED', message: '画面采集服务异常退出' })
  expect(crashed.capturingSinceUs()).toBeUndefined()
  await vi.waitFor(() => expect(crashed.capturingSinceUs()).toBeDefined())
  await crashed.cancel()
  expect(deps.failed).not.toHaveBeenCalled()
  expect(requestTypes()).toEqual(['prepare', 'start', 'stop'])
  expect(storage.manifest.spans.map(span => [span.file, span.finalized])).toEqual([['screen-000000.mp4', false], ['screen-000001.mp4', true]])
})

it('实时预览：画好的一张送到页面的通道；采集中断时不再导入旧句柄，续录开好后自动重新开；停止前先停导入', async () => {
  const imports: string[] = []
  const sharedTexture = {
    importSharedTexture: (input: { textureInfo: { handle?: { ntHandle?: Buffer } } }) => { imports.push(String(input.textureInfo.handle?.ntHandle?.readBigUInt64LE())); return { release: vi.fn() } },
    sendSharedTexture: vi.fn(async () => undefined),
  }
  let slots = ['11', '12', '13']
  const request = client.request.bind(client)
  client.request = async (type, payload) => type === 'startPreview' ? (client.requests.push({ type, payload: payload ?? {} }), { format: 'bgra', codedSize: { width: 960, height: 540 }, slots }) : request(type, payload)
  const capture = new NativeCaptureBackend(options, [960, 540], storage, { client, originUs: 1_000_000, nowUs: () => now, ...deps, sharedTexture: sharedTexture as never })
  await capture.prepare(); await capture.start(signal)
  const target = { isDestroyed: () => false, mainFrame: {} as never }
  await expect(capture.setPreview(target, 'vf-route-1')).resolves.toEqual({ width: 960, height: 540 })
  client.emit({ event: 'preview', slot: 1, sequence: 1, sourceUs: 1 })
  expect(imports).toEqual(['12'])
  expect(sharedTexture.sendSharedTexture).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ route: 'vf-route-1' }))

  client.onRequest = type => { if (type === 'start') client.emit({ event: 'started', originUs: 20_000_000, firstSourceUs: 20_000_000 }) }
  slots = ['21', '22', '23']
  client.emit(interruptedEvent('DEVICE_REMOVED', 60))
  client.emit({ event: 'preview', slot: 0, sequence: 2, sourceUs: 2 })
  expect(imports).toEqual(['12'])
  await vi.waitFor(() => expect(requestTypes().filter(type => type === 'startPreview')).toHaveLength(2))
  await vi.waitFor(() => { client.emit({ event: 'preview', slot: 0, sequence: 1, sourceUs: 3 }); expect(imports).toEqual(['12', '21']) })

  await capture.stop(signal)
  client.emit({ event: 'preview', slot: 2, sequence: 2, sourceUs: 4 })
  expect(imports).toEqual(['12', '21'])
})
