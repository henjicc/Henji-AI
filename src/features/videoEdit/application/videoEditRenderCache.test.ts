import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { clearVideoEditRenderCache, renderVideoEditRenderCache, videoEditRenderCacheBusy, readVideoEditRenderCache, recordVideoEditProgramRender, readyVideoEditRenderWindows, peekVideoEditRenderCache, requestVideoEditRenderBarWindows, subscribeVideoEditRenderBar, videoEditRenderCacheWindows } from './videoEditRenderCache'

type TestWindow = { key: string; startFrame: number; endFrame: number; heavy: boolean; fingerprintPending?: boolean }
const state = vi.hoisted(() => ({
  instances: [] as Array<{ document: { id: string }; contentVersion?: number; playing: boolean; scrubbing: boolean; busy: boolean; playbackDirection?: number; frame?: number }>,
  composition: {} as unknown,
  windows: [{ key: 'window', startFrame: 0, endFrame: 3, heavy: true }] as TestWindow[],
  render: vi.fn(async (..._args: unknown[]): Promise<void | { provenance: 'live' | 'web-cache' }> => {}), dispose: vi.fn(async () => {}), add: vi.fn(async (..._args: unknown[]) => {}),
  discard: vi.fn(async () => {}), commit: vi.fn(async (..._args: unknown[]) => ({})), cancel: vi.fn(async () => {}),
  remove: vi.fn(async (..._args: unknown[]) => 0), list: vi.fn(async () => []),
  webCacheForeground: vi.fn(async (_active: boolean) => undefined),
  fingerprints: vi.fn((..._args: unknown[]): undefined => undefined),
  fingerprintListeners: new Set<() => void>(),
  trackingListeners: new Set<() => void>(), smartRegionListeners: new Set<() => void>(),
  tracks: {} as Record<string, { url: string; version: string }>, smartRegions: {} as Record<string, unknown>, fontRevision: 0,
  sessions: 0, viewListeners: new Set<() => void>(), events: [] as string[],
  windowSet: vi.fn((..._args: unknown[]): { signature: string; windows: TestWindow[] } => ({ signature: 'test', windows: state.windows })),
}))
vi.mock('./videoEditRenderFingerprints', () => ({ videoEditRenderFingerprints: (...args: unknown[]) => state.fingerprints(...args), subscribeVideoEditRenderFingerprints: (listener: () => void) => { state.fingerprintListeners.add(listener); return () => state.fingerprintListeners.delete(listener) } }))
vi.mock('mediabunny', () => ({
  EncodedVideoPacketSource: class { async add() {} }, EncodedPacket: class {}, Mp4OutputFormat: class {}, StreamTarget: class {},
  Output: class { addVideoTrack() {} async start() {} async finalize() {} cancel = state.cancel },
}))
vi.mock('@/core/logging', () => ({ createLogger: () => {
  const record = (_message: string, entry?: { event?: string }): void => { if (entry?.event) state.events.push(entry.event) }
  return { info: vi.fn(record), warn: vi.fn(record), debug: vi.fn(record) }
} }))
vi.mock('@/services/mediaCache/mediaCacheSettings', () => ({ getMediaCacheSettings: () => ({}), subscribeMediaCacheSettings: () => () => {} }))
vi.mock('@/services/mediaCache/hardwareCapabilities', () => ({ resolveRenderCacheCodec: () => 'h264' }))
vi.mock('@/core/videoEdit/renderBitrate', () => ({ videoEditRenderEncoding: () => ({ profile: 'test', codec: 'h264' }) }))
vi.mock('@/core/videoEdit/renderCache', () => ({ videoEditRenderWindowRanges: () => state.windows.map(({ startFrame, endFrame }) => ({ startFrame, endFrame })), videoEditRenderWindowSet: (...args: unknown[]) => state.windowSet(...args) }))
vi.mock('@/platform/fonts', () => ({ fontLibrarySnapshot: () => ({ revision: state.fontRevision }) }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ videoFrames: { webCacheForeground: state.webCacheForeground }, settings: { get: async () => undefined, set: async () => {} }, mediaCache: {
  renderList: state.list, renderRemove: state.remove, renderBegin: async () => 'temporary', renderCommit: state.commit, renderDiscard: state.discard,
} }) }))
// Worker 编码流的替身：渲染一帧（state.render）、送进编码器（state.add，参数与成片时间一致），然后回执提交。
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  async openVideoEncoder() {
    return { close() {}, async flush() {},
      async encode(frame: number, sample: { timestamp: number; duration: number; keyFrame: boolean }, precision: string, submitted: () => void) {
        const rendered = { provenance: 'live', ...await state.render(frame, true, precision) }
        await state.add(sample.timestamp, sample.duration, { keyFrame: sample.keyFrame }); submitted()
        return rendered
      } }
  }
  dispose = state.dispose; setSmartRegions() {} setTracks() {} constructor() { state.sessions++ }
} }))
vi.mock('../engine/videoEditExportEncoder', () => ({ videoEditExportVideoStream: () => ({ codec: 'avc', config: {}, keyFrameInterval: 0 }) }))
vi.mock('./videoEditTracking', () => ({ subscribeVideoEditTracking: (listener: () => void) => { state.trackingListeners.add(listener); return () => state.trackingListeners.delete(listener) }, videoEditTrackResults: () => state.tracks, waitVideoEditTracking: async () => {} }))
vi.mock('./videoEditSmartRegions', () => ({ subscribeVideoEditSmartRegions: (listener: () => void) => { state.smartRegionListeners.add(listener); return () => state.smartRegionListeners.delete(listener) }, videoEditSmartRegionSegments: () => state.smartRegions, waitVideoEditSmartRegions: async () => ({}) }))
const foreground = vi.hoisted(() => ({ inputAt: Number.NEGATIVE_INFINITY, task: undefined as string | undefined, focused: true, systemIdle: false, inputListeners: new Set<() => void>() }))
vi.mock('./videoEditRenderCacheForeground', () => ({
  videoEditUserInputIdleFor: () => performance.now() - foreground.inputAt,
  subscribeVideoEditUserInput: (listener: () => void) => { foreground.inputListeners.add(listener); return () => { foreground.inputListeners.delete(listener) } },
  videoEditGpuTask: () => foreground.task,
  videoEditRecordingActive: () => foreground.task === 'recording',
  // 与正式判断同形：全系统空闲，或有焦点且应用内 10 秒没有输入。
  videoEditUserIdleBasis: () => foreground.systemIdle ? 'system' : foreground.focused && performance.now() - foreground.inputAt >= 10_000 ? 'app' : undefined,
}))
/** 与正式输入监听一样：记下时刻并同步通知。 */
function userInput(): void { foreground.inputAt = performance.now(); for (const listener of foreground.inputListeners) listener() }
vi.mock('./videoEditService', () => ({
  listVideoEditInstances: () => state.instances, requireVideoEditInstance: () => state.instances[0],
  getActiveVideoEditSequence: () => state.composition, findActiveVideoEditSequence: () => state.composition, publishVideoEdit: vi.fn(),
  subscribeVideoEditView: (listener: () => void) => { state.viewListeners.add(listener); return () => { state.viewListeners.delete(listener) } },
  subscribeVideoEditDomain: () => () => undefined,
}))
/** 与正式 setVideoEditView 一样：改了播放状态或播放头就发布视图。 */
function publishView(): void { for (const listener of state.viewListeners) listener() }
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(next => { resolve = next })
  return { promise, resolve }
}
const renderedFrames = (): unknown[] => state.render.mock.calls.map(call => call[0])
const useFakeClock = (): void => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] }) }

beforeEach(() => {
  vi.clearAllMocks()
  state.list.mockReset().mockResolvedValue([])
  state.fingerprints.mockReset(); state.fingerprints.mockReturnValue(undefined)
  const document = createVideoEditTestDocument('预渲染生命周期')
  state.composition = videoEditComposition(document, document.sequences[0].id)
  state.instances = [{ document, contentVersion: 0, playing: false, scrubbing: false, busy: false, frame: 0 }]
  state.add.mockImplementation(async () => {}); state.render.mockImplementation(async () => {})
  state.windows = [{ key: document.id, startFrame: 0, endFrame: 3, heavy: true }]
  state.commit.mockImplementation(async (...args: unknown[]) => ({ ...(args[0] as { entry: object }).entry, path: 'preview.mp4', bytes: 10 }))
  state.sessions = 0; state.viewListeners.clear(); state.events = []
  state.tracks = {}; state.smartRegions = {}; state.fontRevision = 0
  foreground.inputAt = Number.NEGATIVE_INFINITY; foreground.task = undefined; foreground.inputListeners.clear(); foreground.focused = true; foreground.systemIdle = false
})
afterEach(() => { vi.useRealTimers() })

it('分析进度及同内容结果不使在途指纹失效，实际分析或字体变化才失效', () => {
  const owner = state.instances[0] as Parameters<typeof videoEditRenderCacheWindows>[0]
  const composition = state.composition as Parameters<typeof videoEditRenderCacheWindows>[1]
  const currentEnvironment = (): (() => boolean) => {
    videoEditRenderCacheWindows(owner, composition)
    return state.fingerprints.mock.lastCall![5] as () => boolean
  }
  const original = currentEnvironment()
  for (let progress = 0; progress < 3; progress++) {
    state.tracks = { ...state.tracks }; state.smartRegions = { ...state.smartRegions }
    for (const listener of [...state.trackingListeners, ...state.smartRegionListeners]) listener()
    expect(original()).toBe(true)
    expect(currentEnvironment()()).toBe(true)
  }
  state.tracks = { tracker: { url: 'tracking-result', version: '1' } }
  for (const listener of state.trackingListeners) listener()
  expect(original()).toBe(false)
  const tracked = currentEnvironment()
  state.smartRegions = { subject: { foreground: [{ url: 'region-result', startUs: 0, endUs: 1, still: true }] } }
  for (const listener of state.smartRegionListeners) listener()
  expect(tracked()).toBe(false)
  const analyzed = currentEnvironment()
  state.fontRevision++
  expect(analyzed()).toBe(false)
})

it('每帧显式请求关键帧，非整数帧率也不因秒数舍入生成依赖中间帧的缓存', async () => {
  const owner = state.instances[0]
  state.composition = { ...state.composition as object, fps: 30000 / 1001 }
  const result = await renderVideoEditRenderCache(owner.document.id, { scope: 'all', auto: true })
  expect(result).toMatchObject({ cancelled: false, renderedWindows: 1 })
  expect(state.add.mock.calls).toEqual([0, 1, 2].map(frame => [frame * 1001 / 30000, 1001 / 30000, { keyFrame: true }]))
})

it('离开再打开同一工程，旧窗口逐帧取消且丢弃未完成文件', async () => {
  const owner = state.instances[0]
  state.add.mockImplementationOnce(async () => { state.instances = [{ ...owner }] })
  const result = await renderVideoEditRenderCache(owner.document.id, { scope: 'all', auto: true })
  expect(result).toMatchObject({ cancelled: true, renderedWindows: 0, readyFrames: 0 })
  expect(state.render).toHaveBeenCalledTimes(1)
  expect(state.discard).toHaveBeenCalledWith('temporary')
  expect(state.commit).not.toHaveBeenCalled(); expect(state.dispose).toHaveBeenCalledOnce()
})
it('其他实例播放时也让出显卡，停播空闲后才开始渲染', async () => {
  useFakeClock()
  const owner = state.instances[0], other = { ...owner, playing: true }
  state.instances.push(other)
  const pending = renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(200)
  expect(state.render).not.toHaveBeenCalled(); expect(state.sessions).toBe(0)
  other.playing = false; publishView()
  // 刚停播：起播往往紧随其后，10 秒内不开始。
  await vi.advanceTimersByTimeAsync(9800)
  expect(state.render).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(300)
  expect(await pending).toMatchObject({ cancelled: false, renderedWindows: 1 })
  expect(state.render).toHaveBeenCalledTimes(3); expect(state.commit).toHaveBeenCalledOnce()
})
it('等待前台播放时关闭原实例，及时取消且不曾打开会话', async () => {
  useFakeClock()
  const owner = state.instances[0]; owner.playing = true
  const pending = renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(100); state.instances = []
  await vi.advanceTimersByTimeAsync(100)
  expect(await pending).toMatchObject({ cancelled: true })
  expect(state.render).not.toHaveBeenCalled(); expect(state.sessions).toBe(0); expect(state.dispose).not.toHaveBeenCalled()
})
it('起播时立即取消在途帧、释放会话并丢弃未完成文件，停播空闲后从该窗口起点重来', async () => {
  useFakeClock()
  const owner = state.instances[0], slow = deferred()
  state.render.mockImplementationOnce(() => slow.promise)
  const pending = renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(10)
  expect(state.render).toHaveBeenCalledTimes(1)
  owner.playing = true; publishView()
  // 在途这一帧还没算完任务就已让出：会话释放、临时文件丢弃、缓存未登记。
  await vi.advanceTimersByTimeAsync(0)
  expect(state.dispose).toHaveBeenCalledOnce(); expect(state.cancel).toHaveBeenCalledOnce()
  expect(state.discard).toHaveBeenCalledWith('temporary'); expect(state.commit).not.toHaveBeenCalled()
  expect(readVideoEditRenderCache(owner.document.id).windows[0].state).not.toBe('ready')
  slow.resolve()
  await vi.advanceTimersByTimeAsync(5000)
  expect(state.render).toHaveBeenCalledTimes(1)
  owner.playing = false; publishView()
  await vi.advanceTimersByTimeAsync(9900)
  expect(state.render).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(200)
  expect(await pending).toMatchObject({ cancelled: false, renderedWindows: 1, readyFrames: 3 })
  expect(renderedFrames()).toEqual([0, 0, 1, 2])
  expect(state.sessions).toBe(2); expect(state.commit).toHaveBeenCalledOnce(); expect(state.discard).toHaveBeenCalledOnce()
  expect(state.events).toEqual(expect.arrayContaining(['video_edit.render_cache.preempted', 'video_edit.render_cache.resumed', 'video_edit.render_cache.completed']))
  expect(state.events).not.toContain('video_edit.render_cache.cancelled')
})
it('暂停时跳转播放头也让出；已完成的窗口不重做，只重来被打断的窗口', async () => {
  useFakeClock()
  const owner = state.instances[0], slow = deferred()
  state.windows = [{ key: 'first', startFrame: 0, endFrame: 3, heavy: true }, { key: 'second', startFrame: 3, endFrame: 6, heavy: true }]
  state.render.mockImplementation(async (...args: unknown[]) => { if (args[0] === 4 && state.render.mock.calls.length === 5) await slow.promise })
  const pending = renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(10)
  expect(state.commit).toHaveBeenCalledOnce(); expect(renderedFrames()).toEqual([0, 1, 2, 3, 4])
  owner.frame = 120; publishView()
  await vi.advanceTimersByTimeAsync(0)
  expect(state.discard).toHaveBeenCalledOnce(); expect(state.dispose).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(10_100)
  expect(await pending).toMatchObject({ cancelled: false, renderedWindows: 2, readyFrames: 6 })
  expect(renderedFrames()).toEqual([0, 1, 2, 3, 4, 3, 4, 5])
  expect(state.commit.mock.calls.map(call => (call[0] as { entry: { windowKey: string } }).entry.windowKey)).toEqual(['first', 'second'])
})
it('让出等待期间用户取消：结束任务，不再重开会话', async () => {
  useFakeClock()
  const owner = state.instances[0], controller = new AbortController()
  state.render.mockImplementationOnce(() => new Promise<void>(() => {}))
  const pending = renderVideoEditRenderCache(owner.document.id, { scope: 'all' }, controller.signal)
  await vi.advanceTimersByTimeAsync(10)
  owner.scrubbing = true; publishView()
  await vi.advanceTimersByTimeAsync(500)
  controller.abort()
  await vi.advanceTimersByTimeAsync(200)
  expect(await pending).toMatchObject({ cancelled: true, renderedWindows: 0 })
  expect(state.sessions).toBe(1); expect(state.dispose).toHaveBeenCalledOnce(); expect(state.commit).not.toHaveBeenCalled()
})
it('暂停中跳转后停 3.2 秒不恢复：1.3 秒后起播时没有在途预渲染帧挡住节目；停播空闲 10 秒后才继续并渲染完', async () => {
  useFakeClock()
  const owner = state.instances[0], slow = deferred()
  state.render.mockImplementationOnce(() => slow.promise)
  const pending = renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(10)
  owner.frame = 6459; publishView()
  await vi.advanceTimersByTimeAsync(3200)
  // 旧实现 3 秒后就重开会话渲染窗口起始帧，正赶上紧接着的起播。
  expect(state.render).toHaveBeenCalledTimes(1); expect(state.sessions).toBe(1)
  await vi.advanceTimersByTimeAsync(1300)
  owner.playing = true; publishView()
  await vi.advanceTimersByTimeAsync(0)
  expect(state.events.filter(event => event === 'video_edit.render_cache.preempted')).toHaveLength(1)
  slow.resolve()
  await vi.advanceTimersByTimeAsync(5000)
  owner.playing = false; publishView()
  await vi.advanceTimersByTimeAsync(9900)
  expect(state.render).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(200)
  expect(await pending).toMatchObject({ cancelled: false, renderedWindows: 1, readyFrames: 3 })
  expect(renderedFrames()).toEqual([0, 0, 1, 2])
})
it('恢复后很快又被起播打断：下一次等待加倍；完整渲染完一个窗口后回到起始等待', async () => {
  useFakeClock()
  const owner = state.instances[0]
  state.windows = [{ key: 'first', startFrame: 0, endFrame: 3, heavy: true }, { key: 'second', startFrame: 3, endFrame: 6, heavy: true }]
  // 前两次渲染都停在第一帧，直到被节目操作打断。
  state.render.mockImplementation(async () => { if (state.render.mock.calls.length <= 2) await new Promise(() => {}) })
  const pending = renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(10)
  owner.frame = 300; publishView()
  await vi.advanceTimersByTimeAsync(10_100)
  expect(state.render).toHaveBeenCalledTimes(2)
  // 恢复 2 秒后用户起播又停下：恢复得太早，这次要空闲 20 秒。
  await vi.advanceTimersByTimeAsync(2000)
  owner.playing = true; publishView(); await vi.advanceTimersByTimeAsync(500)
  owner.playing = false; publishView()
  await vi.advanceTimersByTimeAsync(19_800)
  expect(state.render).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(300)
  expect(renderedFrames()).toEqual([0, 0, 0, 1, 2, 3, 4, 5])
  expect(await pending).toMatchObject({ cancelled: false, renderedWindows: 2 })
})
type SchedulerOwner = (typeof state.instances)[number] & { activeSequenceId?: string }
async function useFreshScheduler(): Promise<{ fresh: typeof import('./videoEditRenderCache'); owner: SchedulerOwner }> {
  useFakeClock()
  vi.resetModules()
  const fresh = await import('./videoEditRenderCache')
  const owner = state.instances[0] as SchedulerOwner
  owner.activeSequenceId = (state.composition as { id: string }).id
  return { fresh, owner }
}
it('自动预渲染：刚打开 30 秒内不开始；用户停播后 10 秒内也不开始，以免撞上紧接着的起播；最快半速出帧', async () => {
  const { fresh, owner } = await useFreshScheduler()
  const started: number[] = []
  state.render.mockImplementation(async () => { started.push(performance.now()) })
  fresh.readVideoEditRenderCache(owner.document.id)
  await vi.advanceTimersByTimeAsync(29_000)
  expect(state.render).not.toHaveBeenCalled()
  owner.playing = true; publishView()
  await vi.advanceTimersByTimeAsync(4000)
  owner.playing = false; publishView()
  await vi.advanceTimersByTimeAsync(9500)
  expect(state.render).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1500)
  expect(state.events).toContain('video_edit.render_cache.auto_start')
  expect(state.commit).toHaveBeenCalledOnce()
  // 30 帧序列半速：渲染不耗时，相邻两帧开始也至少隔 1000 / 15 ≈ 67 毫秒。
  const gaps = started.slice(1).map((at, index) => at - started[index])
  expect(gaps).toHaveLength(2)
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000 / 15 - 1)
  state.instances = []; await vi.advanceTimersByTimeAsync(1000)
})
it('自动预渲染：编辑停下不到 10 秒、用户 10 秒内有过输入、有占显卡的前台任务或应用不在前台时不开始', async () => {
  const { fresh, owner } = await useFreshScheduler()
  fresh.readVideoEditRenderCache(owner.document.id)
  await vi.advanceTimersByTimeAsync(25_000)
  userInput()
  await vi.advanceTimersByTimeAsync(8000)
  owner.contentVersion = 1
  await vi.advanceTimersByTimeAsync(9000)
  expect(state.render).not.toHaveBeenCalled()
  foreground.task = 'proxy'
  await vi.advanceTimersByTimeAsync(20_000)
  expect(state.render).not.toHaveBeenCalled()
  foreground.task = undefined; foreground.focused = false
  await vi.advanceTimersByTimeAsync(5000)
  expect(state.render).not.toHaveBeenCalled()
  foreground.focused = true
  await vi.advanceTimersByTimeAsync(1100)
  expect(state.render).toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(300)
  state.instances = []; await vi.advanceTimersByTimeAsync(1000)
})
it('自动预渲染中用户一输入就停止并释放会话、不占着任务；输入空闲后重新发起，已完成的窗口不重做', async () => {
  const { fresh, owner } = await useFreshScheduler()
  state.windows = [{ key: 'first', startFrame: 0, endFrame: 3, heavy: true }, { key: 'second', startFrame: 3, endFrame: 6, heavy: true }]
  state.render.mockImplementation(() => new Promise<void>(resolve => setTimeout(resolve, 40)))
  fresh.readVideoEditRenderCache(owner.document.id)
  await vi.advanceTimersByTimeAsync(31_000)
  expect(state.render).toHaveBeenCalled()
  // 每帧 40 毫秒渲染 + 40 毫秒歇：第一个窗口约 0.24 秒完成，随后在第二个窗口途中输入。
  await vi.advanceTimersByTimeAsync(300)
  expect(state.commit).toHaveBeenCalledOnce()
  userInput()
  await vi.advanceTimersByTimeAsync(0)
  expect(state.events).toContain('video_edit.render_cache.preempted')
  expect(state.dispose).toHaveBeenCalledOnce(); expect(state.discard).toHaveBeenCalledOnce()
  expect(state.events).toContain('video_edit.render_cache.cancelled')
  expect(fresh.readVideoEditRenderCache(owner.document.id).rendering).toBeNull()
  expect(fresh.videoEditRenderCacheBusy(owner as Parameters<typeof fresh.videoEditRenderCacheBusy>[0])).toBe(false)
  const rendered = state.render.mock.calls.length
  await vi.advanceTimersByTimeAsync(9000)
  expect(state.render).toHaveBeenCalledTimes(rendered)
  await vi.advanceTimersByTimeAsync(2000)
  expect(state.commit).toHaveBeenCalledTimes(2)
  expect(renderedFrames().filter(frame => (frame as number) < 3)).toEqual([0, 1, 2])
  expect(state.events.filter(event => event === 'video_edit.render_cache.auto_start')).toHaveLength(2)
  state.instances = []; await vi.advanceTimersByTimeAsync(1000)
})
it('用户请求的预渲染只为录屏暂停并给出原因，建代理与点按界面不暂停；暂停期间不算占用，录完空闲后续上', async () => {
  useFakeClock()
  const owner = state.instances[0]
  state.windows = [{ key: 'request-first', startFrame: 0, endFrame: 3, heavy: true }, { key: 'request-second', startFrame: 3, endFrame: 6, heavy: true }]
  state.render.mockImplementation(() => new Promise<void>(resolve => setTimeout(resolve, 400)))
  const pending = renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(50)
  userInput(); foreground.task = 'proxy'
  await vi.advanceTimersByTimeAsync(150)
  expect(state.events).not.toContain('video_edit.render_cache.preempted')
  foreground.task = 'recording'
  await vi.advanceTimersByTimeAsync(150)
  expect(state.events).toContain('video_edit.render_cache.preempted'); expect(state.dispose).toHaveBeenCalledOnce()
  expect(readVideoEditRenderCache(owner.document.id).rendering).toMatchObject({ auto: false, paused: '正在录屏，录完后继续渲染' })
  expect(videoEditRenderCacheBusy(owner as Parameters<typeof videoEditRenderCacheBusy>[0])).toBe(false)
  const rendered = state.render.mock.calls.length
  await vi.advanceTimersByTimeAsync(5000)
  expect(state.render).toHaveBeenCalledTimes(rendered)
  foreground.task = undefined
  await vi.advanceTimersByTimeAsync(8000)
  expect(readVideoEditRenderCache(owner.document.id).rendering).toBeNull()
  expect(await pending).toMatchObject({ cancelled: false, renderedWindows: 2 })
})
it('多机位格子同时在解码时节目掉帧不计入实测；正常播放掉帧的普通段照常自动预渲染', async () => {
  const { fresh, owner } = await useFreshScheduler()
  state.windows = [{ key: 'plain-dropped', startFrame: 0, endFrame: 80, heavy: false }]
  owner.playing = true; owner.playbackDirection = 1
  const composition = state.composition as Parameters<typeof recordVideoEditProgramRender>[1]
  const sample = { id: 1, presented: true, renderCached: false, renderElapsedMs: 10 }
  fresh.noteVideoEditProgramSideLoad(owner as Parameters<typeof fresh.noteVideoEditProgramSideLoad>[0])
  for (let frame = 0; frame < 60; frame += 2) fresh.recordVideoEditProgramRender(owner.document.id, composition, frame, sample, true)
  expect(fresh.readVideoEditRenderCache(owner.document.id).windows[0].state).toBe('realtime')
  // 格子停下（隐藏、收起、关闭）一秒后不再算节目旁负载。
  await vi.advanceTimersByTimeAsync(1100)
  for (let frame = 0; frame < 60; frame += 2) fresh.recordVideoEditProgramRender(owner.document.id, composition, frame, sample, true)
  owner.playing = false
  expect(fresh.readVideoEditRenderCache(owner.document.id).windows[0].state).toBe('dropped')
  await vi.advanceTimersByTimeAsync(45_000)
  expect(state.render).toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(8000)
  state.instances = []; await vi.advanceTimersByTimeAsync(1000)
})
it('应用不在前台时，全系统空闲达到阈值也会开始；全系统一有输入即停止', async () => {
  const { fresh, owner } = await useFreshScheduler()
  state.windows = [{ key: 'away-first', startFrame: 0, endFrame: 3, heavy: true }]
  state.render.mockImplementation(() => new Promise<void>(resolve => setTimeout(resolve, 40)))
  foreground.focused = false
  fresh.readVideoEditRenderCache(owner.document.id)
  await vi.advanceTimersByTimeAsync(40_000)
  expect(state.render).not.toHaveBeenCalled()
  foreground.systemIdle = true
  await vi.advanceTimersByTimeAsync(1100)
  expect(state.render).toHaveBeenCalled()
  foreground.systemIdle = false
  await vi.advanceTimersByTimeAsync(150)
  expect(state.events).toContain('video_edit.render_cache.preempted'); expect(state.events).toContain('video_edit.render_cache.cancelled')
  expect(state.commit).not.toHaveBeenCalled(); expect(state.dispose).toHaveBeenCalledOnce()
  state.instances = []; await vi.advanceTimersByTimeAsync(1000)
})
it('用户请求的预渲染在会话打开前就遇到录屏：显示暂停原因，录完续上时原因清除', async () => {
  useFakeClock()
  const owner = state.instances[0]
  state.windows = [{ key: 'request-before-session', startFrame: 0, endFrame: 3, heavy: true }]
  foreground.task = 'recording'
  const pending = renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(300)
  expect(state.sessions).toBe(0)
  expect(readVideoEditRenderCache(owner.document.id).rendering).toMatchObject({ paused: '正在录屏，录完后继续渲染' })
  foreground.task = undefined
  await vi.advanceTimersByTimeAsync(3200)
  expect(readVideoEditRenderCache(owner.document.id).rendering?.paused).toBeUndefined()
  await vi.advanceTimersByTimeAsync(1000)
  expect(await pending).toMatchObject({ cancelled: false, renderedWindows: 1 })
})
it('自动预渲染等节目首帧上屏后才开始，不和打开工程抢解码与显卡', async () => {
  useFakeClock()
  vi.resetModules()
  const timing = await import('../engine/videoEditFirstFrameTiming')
  const fresh = await import('./videoEditRenderCache')
  const owner = state.instances[0] as (typeof state.instances)[number] & { activeSequenceId?: string }
  owner.activeSequenceId = (state.composition as { id: string }).id
  fresh.readVideoEditRenderCache(owner.document.id)
  // 打开后的等待已过，此时（如切换序列）又在等首帧。
  await vi.advanceTimersByTimeAsync(25_000)
  timing.beginVideoEditFirstFrame(owner.document.id, owner.activeSequenceId, 'open')
  await vi.advanceTimersByTimeAsync(15_000)
  expect(state.render).not.toHaveBeenCalled()
  timing.recordVideoEditFirstFrame(owner.document.id, owner.activeSequenceId, {})
  await vi.advanceTimersByTimeAsync(1100)
  expect(state.render).toHaveBeenCalled()
  timing.endVideoEditTiming(owner.document.id); state.instances = []; await vi.advanceTimersByTimeAsync(1000)
})
it('自动预渲染每渲完一帧歇同样长的时间；歇着时跳转播放头立即让出', async () => {
  useFakeClock()
  vi.resetModules()
  const fresh = await import('./videoEditRenderCache')
  const owner = state.instances[0]
  state.render.mockImplementation(() => new Promise<void>(resolve => setTimeout(resolve, 40)))
  const pending = fresh.renderVideoEditRenderCache(owner.document.id, { scope: 'all', auto: true })
  // 第一帧 0–40 毫秒，随后歇到 80 毫秒才开始第二帧。
  await vi.advanceTimersByTimeAsync(70)
  expect(state.render).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(20)
  expect(state.render).toHaveBeenCalledTimes(2)
  // 第二帧 120 毫秒渲完，歇着的时候用户跳转。
  await vi.advanceTimersByTimeAsync(40)
  owner.frame = 90; publishView()
  await vi.advanceTimersByTimeAsync(0)
  expect(state.events).toContain('video_edit.render_cache.preempted')
  expect(state.discard).toHaveBeenCalledOnce(); expect(state.dispose).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1000)
  expect(state.render).toHaveBeenCalledTimes(2)
  state.instances = []; await vi.advanceTimersByTimeAsync(200)
  expect(await pending).toMatchObject({ cancelled: true, renderedWindows: 0 })
})
it('自动预渲染歇着时取消：任务结束，不再渲染下一帧', async () => {
  useFakeClock()
  vi.resetModules()
  const fresh = await import('./videoEditRenderCache')
  const owner = state.instances[0], controller = new AbortController()
  state.render.mockImplementation(() => new Promise<void>(resolve => setTimeout(resolve, 40)))
  const pending = fresh.renderVideoEditRenderCache(owner.document.id, { scope: 'all', auto: true }, controller.signal)
  await vi.advanceTimersByTimeAsync(60)
  controller.abort()
  await vi.advanceTimersByTimeAsync(1000)
  expect(await pending).toMatchObject({ cancelled: true, renderedWindows: 0 })
  expect(state.render).toHaveBeenCalledTimes(1); expect(state.commit).not.toHaveBeenCalled(); expect(state.discard).toHaveBeenCalledOnce()
})


it('仅节目正放进入观测：单帧超预算但按时呈现不标红，跳帧超过5%标红并被needed选择', async () => {
  state.windows = [{ key: 'content', startFrame: 0, endFrame: 80, heavy: true }]
  const owner = state.instances[0]
  owner.playing = true; owner.playbackDirection = 1
  const composition = state.composition as Parameters<typeof recordVideoEditProgramRender>[1]
  const sample = { id: 1, presented: true, renderCached: false, renderElapsedMs: 80, renderStages: { codeReady: 70 } }
  for (let frame = 0; frame < 20; frame++) {
    recordVideoEditProgramRender(owner.document.id, composition, 0, { ...sample, renderCached: true }, true)
    recordVideoEditProgramRender(owner.document.id, composition, 0, sample, false)
    recordVideoEditProgramRender(owner.document.id, composition, 0, { ...sample, presented: false }, true)
  }
  expect(readVideoEditRenderCache(owner.document.id).windows[0].performance).toBeUndefined()
  for (let frame = 0; frame < 20; frame++) recordVideoEditProgramRender(owner.document.id, composition, frame, sample, true)
  expect(readVideoEditRenderCache(owner.document.id).windows[0]).toMatchObject({ state: 'realtime', performance: { sampleFrames: 20, droppedFrames: 0 } })
  for (let frame = 21; frame < 60; frame += 2) recordVideoEditProgramRender(owner.document.id, composition, frame, sample, true)
  expect(readVideoEditRenderCache(owner.document.id).windows[0]).toMatchObject({ state: 'dropped', performance: { sampleFrames: 60, droppedFrames: 20 } })
  owner.playing = false
  expect((await renderVideoEditRenderCache(owner.document.id, { scope: 'needed' })).renderedWindows).toBe(1)
  expect(readVideoEditRenderCache(owner.document.id).windows[0].state).toBe('ready')
})

it('相同内容的两个位置只编码一次，整体平移使用当前起点；all包含实时段', async () => {
  const owner = state.instances[0]
  state.windows = [{ key: owner.document.id, startFrame: 0, endFrame: 3, heavy: false }, { key: owner.document.id, startFrame: 3, endFrame: 6, heavy: false }]
  expect((await renderVideoEditRenderCache(owner.document.id, { scope: 'needed' })).renderedWindows).toBe(0)
  expect((await renderVideoEditRenderCache(owner.document.id, { scope: 'all' })).renderedWindows).toBe(1)
  expect(state.render).toHaveBeenCalledTimes(3)
  const composition = state.composition as Parameters<typeof readyVideoEditRenderWindows>[1]
  state.windows = state.windows.map(window => ({ ...window, startFrame: window.startFrame + 60, endFrame: window.endFrame + 60 }))
  state.composition = { ...composition }
  const ready = readyVideoEditRenderWindows(owner.document.id, state.composition as typeof composition)
  expect(ready.map(window => [window.startFrame, window.endFrame, window.path])).toEqual([[60, 63, 'preview.mp4'], [63, 66, 'preview.mp4']])
})


it('渲染途中窗口换了指纹（字体库读完）：旧指纹的文件照常登记，按新指纹再渲一遍，渲染条不留空段', async () => {
  const owner = state.instances[0]
  state.windows = [{ key: 'before-fonts', startFrame: 0, endFrame: 3, heavy: true }]
  state.render.mockImplementationOnce(async () => { state.fontRevision = 1; state.windows = [{ key: 'after-fonts', startFrame: 0, endFrame: 3, heavy: true }] })
  await renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  expect(state.commit.mock.calls.map(call => (call[0] as { entry: { windowKey: string } }).entry.windowKey)).toEqual(['before-fonts', 'after-fonts'])
  expect(state.render).toHaveBeenCalledTimes(6)
  const ready = readyVideoEditRenderWindows(owner.document.id, state.composition as Parameters<typeof readyVideoEditRenderWindows>[1])
  expect(ready.map(window => window.key)).toEqual(['after-fonts'])
})

it('实测流畅覆盖重段预测，取消仅丢当前段并保留已完成段', async () => {
  const owner = state.instances[0], composition = state.composition as Parameters<typeof recordVideoEditProgramRender>[1]
  owner.playing = true; owner.playbackDirection = 1
  for (let frame = 0; frame < 20; frame++) recordVideoEditProgramRender(owner.document.id, composition, 0, { id: 1, presented: true, renderCached: false, renderElapsedMs: 1 }, true)
  expect(readVideoEditRenderCache(owner.document.id).windows[0].state).toBe('realtime')
  owner.playing = false
  expect((await renderVideoEditRenderCache(owner.document.id, { scope: 'needed' })).renderedWindows).toBe(0)
  state.windows.push({ key: owner.document.id + '-second', startFrame: 3, endFrame: 6, heavy: true })
  const controller = new AbortController()
  state.add.mockImplementation(async () => { if (state.add.mock.calls.length === 4) controller.abort() })
  const result = await renderVideoEditRenderCache(owner.document.id, { scope: 'all' }, controller.signal)
  expect(result).toMatchObject({ cancelled: true, renderedWindows: 1, readyFrames: 3 })
  expect(state.commit).toHaveBeenCalledOnce()
  expect(state.discard).toHaveBeenCalledOnce()
})

it('渲染条重绘不分段：内容变了先给当前边界的未就绪读数，空闲时只算最新内容，算完通知渲染条', async () => {
  useFakeClock()
  const owner = state.instances[0] as (typeof state.instances)[number] & { activeSequenceId?: string }, projectId = owner.document.id
  // 当前序列与节目、渲染条共用同一份合成：加载缓存时的回收不另算一遍。
  owner.activeSequenceId = (state.composition as { id: string }).id
  expect(peekVideoEditRenderCache(projectId)).toMatchObject({ view: { windows: [{ state: 'predicted', startFrame: 0 }], readyFrames: 0 }, current: false })
  expect(state.windowSet).not.toHaveBeenCalled()
  const notified = vi.fn(); const stop = subscribeVideoEditRenderBar(notified)
  requestVideoEditRenderBarWindows(projectId); requestVideoEditRenderBarWindows(projectId)
  expect(state.windowSet).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(0)
  expect(state.windowSet).toHaveBeenCalledOnce(); expect(notified).toHaveBeenCalledOnce()
  const first = peekVideoEditRenderCache(projectId)
  expect(first.current).toBe(true); expect(first.view?.windows.map(window => window.startFrame)).toEqual([0])
  // 新快照只切当前边界，绝不沿用旧绿色或旧边界。
  state.composition = { ...(state.composition as object) }; state.windows = [{ key: 'moved', startFrame: 30, endFrame: 33, heavy: true }]
  expect(peekVideoEditRenderCache(projectId)).toMatchObject({ view: { windows: [{ state: 'predicted', startFrame: 30 }], readyFrames: 0 }, current: false })
  requestVideoEditRenderBarWindows(projectId)
  // 空闲前又编辑一次：旧快照不再算，只算最新的。
  state.composition = { ...(state.composition as object) }
  requestVideoEditRenderBarWindows(projectId)
  await vi.advanceTimersByTimeAsync(0)
  expect(state.windowSet).toHaveBeenCalledTimes(2); expect(notified).toHaveBeenCalledTimes(2)
  expect(peekVideoEditRenderCache(projectId).view?.windows.map(window => window.startFrame)).toEqual([30])
  expect(state.windowSet).toHaveBeenCalledTimes(2)
  stop()
})

it('回收过期文件时同一文档快照的各序列只分段一次，分段沿用同一序列上一次的结果', async () => {
  const owner = state.instances[0]
  await renderVideoEditRenderCache(owner.document.id, { scope: 'needed' })
  const calls = state.windowSet.mock.calls.length
  await renderVideoEditRenderCache(owner.document.id, { scope: 'needed' })
  expect(state.windowSet.mock.calls.length).toBe(calls)
  // 新快照才重新分段，并把同一序列上一次的结果交给签名比较。
  const previous = state.windowSet.mock.results.at(-1)!.value
  state.composition = { ...(state.composition as object) }
  readVideoEditRenderCache(owner.document.id)
  expect(state.windowSet.mock.calls.at(-1)![2]).toBe(previous)
})


it('范围清理只删除相交整窗，边界接触保留；全部清理删除本序列所有窗口', async () => {
  const owner = state.instances[0]
  state.windows = [0, 3, 6].map(startFrame => ({ key: `${owner.document.id}-${startFrame}`, startFrame, endFrame: startFrame + 3, heavy: true }))
  await renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  expect(readVideoEditRenderCache(owner.document.id).readyFrames).toBe(9)
  await clearVideoEditRenderCache(owner.document.id, { startFrame: 3, endFrame: 6 })
  expect(state.remove).toHaveBeenLastCalledWith({ projectId: owner.document.id, windowKeys: [state.windows[1].key] })
  expect(readVideoEditRenderCache(owner.document.id).windows.map(window => window.state)).toEqual(['ready', 'predicted', 'ready'])
  await clearVideoEditRenderCache(owner.document.id)
  expect(state.remove).toHaveBeenLastCalledWith({ projectId: owner.document.id, windowKeys: state.windows.map(window => window.key) })
  expect(readVideoEditRenderCache(owner.document.id).readyFrames).toBe(0)
})

it('相同文件复用到新位置后，清理按序列当前窗口而非文件最初写入的位置判断范围', async () => {
  const owner = state.instances[0]
  await renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  state.composition = { ...state.composition as object }
  state.windows = [{ ...state.windows[0], startFrame: 10, endFrame: 13 }]
  await clearVideoEditRenderCache(owner.document.id, { startFrame: 0, endFrame: 1 })
  expect(readVideoEditRenderCache(owner.document.id).readyFrames).toBe(3)
  expect(state.remove).not.toHaveBeenCalled()
  await clearVideoEditRenderCache(owner.document.id, { startFrame: 11, endFrame: 12 })
  expect(readVideoEditRenderCache(owner.document.id).readyFrames).toBe(0)
  expect(state.remove).toHaveBeenLastCalledWith({ projectId: owner.document.id, windowKeys: [state.windows[0].key] })
})

it('删除先取消在途编码并禁止插入新渲染，不会有迟到窗口重新变为就绪', async () => {
  useFakeClock()
  const owner = state.instances[0], gate = deferred()
  state.add.mockImplementationOnce(() => gate.promise)
  const render = renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(0)
  expect(state.add).toHaveBeenCalledOnce()
  const clear = clearVideoEditRenderCache(owner.document.id)
  await expect(renderVideoEditRenderCache(owner.document.id, { scope: 'all' })).rejects.toThrow('正在删除')
  await vi.advanceTimersByTimeAsync(30)
  // 在途的一帧不拖住删除：任务随取消立即停编码、丢弃临时文件并退出，之后才删除，没有半成品登记。
  expect(state.discard).toHaveBeenCalledOnce(); expect(state.commit).not.toHaveBeenCalled()
  gate.resolve()
  await vi.advanceTimersByTimeAsync(30)
  await render; await clear
  expect(readVideoEditRenderCache(owner.document.id).readyFrames).toBe(0)
  const commits = state.commit.mock.calls.length
  await vi.advanceTimersByTimeAsync(100)
  expect(state.commit).toHaveBeenCalledTimes(commits)
})

it('前一次清理失败不阻断已经排队的另一范围请求，各次请求保留自己的结果', async () => {
  const owner = state.instances[0]
  await renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  state.remove.mockRejectedValueOnce(new Error('磁盘暂不可写'))
  const first = clearVideoEditRenderCache(owner.document.id)
  const second = clearVideoEditRenderCache(owner.document.id, { startFrame: 0, endFrame: 1 })
  await expect(first).rejects.toThrow('磁盘暂不可写')
  await second
  expect(state.remove).toHaveBeenCalledTimes(2)
  expect(readVideoEditRenderCache(owner.document.id).readyFrames).toBe(0)
})


it('取消等待跨过自动调度时刻时，不在旧任务退出和取消回读之间启动新的自动任务', async () => {
  useFakeClock(); vi.resetModules()
  const fresh = await import('./videoEditRenderCache')
  const owner = state.instances[0] as (typeof state.instances)[number] & { activeSequenceId?: string }
  owner.activeSequenceId = (state.composition as { id: string }).id
  state.windows = [0, 3].map(startFrame => ({ key: `${owner.document.id}-${startFrame}`, startFrame, endFrame: startFrame + 3, heavy: true }))
  const gate = deferred()
  state.add.mockImplementation(async () => { if (state.add.mock.calls.length === 4) await gate.promise })
  fresh.readVideoEditRenderCache(owner.document.id)
  const render = fresh.renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(0)
  expect(state.add).toHaveBeenCalledTimes(4)
  await vi.advanceTimersByTimeAsync(3990)
  const cancel = fresh.cancelVideoEditRenderCache(owner.document.id)
  await vi.advanceTimersByTimeAsync(5)
  gate.resolve()
  await vi.advanceTimersByTimeAsync(25)
  await render; await cancel
  expect(state.render).toHaveBeenCalledTimes(4)
  expect(fresh.readVideoEditRenderCache(owner.document.id)).toMatchObject({ readyFrames: 3, rendering: null })
})


it('导出准备等待首次代码声明完成，不把读取中的窗口当作没有预览', async () => {
  useFakeClock(); vi.resetModules()
  const fresh = await import('./videoEditRenderCache')
  const { VideoEditCodeMetadataPending } = await import('./videoEditCodeState')
  const owner = state.instances[0], gate = deferred()
  let waiting = true, finished = false
  state.fingerprints.mockImplementation(() => { if (waiting) throw new VideoEditCodeMetadataPending(gate.promise); return undefined })
  const pending = fresh.prepareVideoEditRenderWindows(owner.document.id, state.composition as Parameters<typeof readyVideoEditRenderWindows>[1], new AbortController().signal).then(result => { finished = true; return result })
  await vi.advanceTimersByTimeAsync(0)
  expect(state.fingerprints).toHaveBeenCalled(); expect(finished).toBe(false)
  waiting = false; gate.resolve()
  await vi.advanceTimersByTimeAsync(0)
  expect(await pending).toEqual([]); expect(finished).toBe(true)
})

it('有候选旧预览时导出准备等待指纹完成，busy 不导致提前固定空预览表', async () => {
  useFakeClock(); vi.resetModules()
  const fresh = await import('./videoEditRenderCache')
  const owner = state.instances[0]
  const rendered = fresh.renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(30); await rendered
  state.windows = [{ ...state.windows[0], fingerprintPending: true }]
  for (const listener of state.fingerprintListeners) listener()
  owner.busy = true
  let finished = false
  const pending = fresh.prepareVideoEditRenderWindows(owner.document.id, state.composition as Parameters<typeof readyVideoEditRenderWindows>[1], new AbortController().signal)
    .then(result => { finished = true; return result })
  await vi.advanceTimersByTimeAsync(0)
  expect(finished).toBe(false)
  state.windows = [{ ...state.windows[0], fingerprintPending: false }]
  for (const listener of state.fingerprintListeners) listener()
  expect(await pending).toEqual([expect.objectContaining({ path: 'preview.mp4', startFrame: 0, endFrame: 3 })])
  expect(owner.busy).toBe(true)
  expect(state.sessions).toBe(1)
})

it('导出准备等待帧指纹时可取消，并释放等待订阅', async () => {
  useFakeClock(); vi.resetModules()
  const fresh = await import('./videoEditRenderCache')
  const owner = state.instances[0]
  const rendered = fresh.renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(30); await rendered
  state.windows = [{ ...state.windows[0], fingerprintPending: true }]
  for (const listener of state.fingerprintListeners) listener()
  owner.busy = true
  const controller = new AbortController(), listeners = state.viewListeners.size
  const pending = fresh.prepareVideoEditRenderWindows(owner.document.id, state.composition as Parameters<typeof readyVideoEditRenderWindows>[1], controller.signal)
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(0)
  expect(state.viewListeners.size).toBe(listeners + 1)
  controller.abort(); await rejected
  expect(state.viewListeners.size).toBe(listeners)
})

it('帧指纹持续缺失时导出准备在 30 秒后退出等待，允许现场合成并释放订阅', async () => {
  useFakeClock(); vi.resetModules()
  const fresh = await import('./videoEditRenderCache')
  const owner = state.instances[0]
  const rendered = fresh.renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(30); await rendered
  state.windows = [{ ...state.windows[0], fingerprintPending: true }]
  for (const listener of state.fingerprintListeners) listener()
  owner.busy = true
  const listeners = state.viewListeners.size
  const pending = fresh.prepareVideoEditRenderWindows(owner.document.id, state.composition as Parameters<typeof readyVideoEditRenderWindows>[1], new AbortController().signal)
  const rejected = expect(pending).rejects.toThrow('使用现场合成导出')
  await vi.advanceTimersByTimeAsync(29_999)
  expect(state.viewListeners.size).toBe(listeners + 1)
  await vi.advanceTimersByTimeAsync(1); await rejected
  expect(state.viewListeners.size).toBe(listeners)
})

it('请求不等待其他序列挂起的声明，已完成窗口保留且不提前回收未知文件', async () => {
  useFakeClock(); vi.resetModules()
  const fresh = await import('./videoEditRenderCache')
  const { VideoEditCodeMetadataPending } = await import('./videoEditCodeState')
  const owner = state.instances[0]
  const document = owner.document as ReturnType<typeof createVideoEditTestDocument>
  document.sequences.push({ ...document.sequences[0], id: 'secondary-fingerprint' })
  const gate = deferred()
  let waiting = true
  state.fingerprints.mockImplementation((_owner, composition) => {
    if (waiting && (composition as { id: string }).id === 'secondary-fingerprint') throw new VideoEditCodeMetadataPending(gate.promise)
    return undefined
  })
  const rendering = fresh.renderVideoEditRenderCache(document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(1)
  expect(state.events).toContain('video_edit.render_cache.start')
  await vi.advanceTimersByTimeAsync(30)
  expect(await rendering).toMatchObject({ cancelled: false, renderedWindows: 1 })
  expect(state.render).toHaveBeenCalledTimes(3); expect(state.remove).not.toHaveBeenCalled()
  waiting = false; gate.resolve()
  await vi.advanceTimersByTimeAsync(1)
  expect(state.remove).not.toHaveBeenCalled()
})


it('指纹未就绪时窗口为 predicted 且立即回执排队；仅所需窗口就绪即渲染并可读缓存', async () => {
  useFakeClock()
  const owner = state.instances[0]
  state.windows = [
    { key: 'pending-first', startFrame: 0, endFrame: 3, heavy: true, fingerprintPending: true },
    { key: 'pending-other', startFrame: 3, endFrame: 6, heavy: true, fingerprintPending: true },
  ]
  const started = vi.fn()
  const rendering = renderVideoEditRenderCache(owner.document.id, { scope: 'all', range: { startFrame: 0, endFrame: 3 } }, undefined, started)
  await vi.advanceTimersByTimeAsync(1)
  expect(started).toHaveBeenCalledWith({ pendingWindows: 1, readyFrames: 0, requestedFrames: 3 })
  expect(readVideoEditRenderCache(owner.document.id)).toMatchObject({ totalFrames: 6, readyFrames: 0, windows: [{ state: 'predicted' }, { state: 'predicted' }], rendering: { total: 1 } })
  expect(state.render).not.toHaveBeenCalled()
  state.windows[0] = { ...state.windows[0], key: 'resolved-first', fingerprintPending: false }
  for (const listener of state.fingerprintListeners) listener()
  await vi.advanceTimersByTimeAsync(50)
  expect(await rendering).toMatchObject({ renderedWindows: 1, readyFrames: 3 })
  expect(readVideoEditRenderCache(owner.document.id).windows.map(window => window.state)).toEqual(['ready', 'predicted'])
  expect(readyVideoEditRenderWindows(owner.document.id, state.composition as Parameters<typeof readyVideoEditRenderWindows>[1])).toMatchObject([{ key: 'resolved-first', startFrame: 0, endFrame: 3 }])
  // 即使暂时键值碰到已存文件，未就绪标记也必须阻止复用和绿色。
  state.windows[0] = { ...state.windows[0], fingerprintPending: true }
  for (const listener of state.fingerprintListeners) listener()
  expect(readyVideoEditRenderWindows(owner.document.id, state.composition as Parameters<typeof readyVideoEditRenderWindows>[1])).toEqual([])
  expect(readVideoEditRenderCache(owner.document.id).windows.map(window => window.state)).toEqual(['predicted', 'predicted'])
  expect(peekVideoEditRenderCache(owner.document.id).view?.readyFrames).toBe(0)
})


it('删除等待指纹时可取消或超时，元数据更新后可继续且只按当前窗口清理', async () => {
  useFakeClock()
  const owner = state.instances[0]
  await renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  owner.busy = true
  state.composition = { ...state.composition as object }
  state.windows = [{ ...state.windows[0], fingerprintPending: true }]
  const controller = new AbortController()
  const cancelled = clearVideoEditRenderCache(owner.document.id, undefined, controller.signal)
  const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(1); controller.abort(); await rejection
  const timeout = clearVideoEditRenderCache(owner.document.id)
  const timedOut = expect(timeout).rejects.toThrow('画面依赖尚未就绪')
  await vi.advanceTimersByTimeAsync(30_000); await timedOut
  expect(state.remove).not.toHaveBeenCalled()
  const clearing = clearVideoEditRenderCache(owner.document.id)
  await vi.advanceTimersByTimeAsync(1)
  owner.document = { ...owner.document }
  state.windows = [{ ...state.windows[0], fingerprintPending: false }]
  for (const listener of state.fingerprintListeners) listener()
  await clearing
  expect(state.remove).toHaveBeenCalledOnce()
  owner.busy = false
  expect((await renderVideoEditRenderCache(owner.document.id, { scope: 'all' })).cancelled).toBe(false)
})

it('删除等待指纹时关闭实例立即结束，不删除文件', async () => {
  useFakeClock()
  const owner = state.instances[0]
  state.windows = [{ ...state.windows[0], fingerprintPending: true }]
  const clearing = clearVideoEditRenderCache(owner.document.id)
  const rejected = expect(clearing).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(1)
  state.instances = []; publishView()
  await rejected
  expect(state.remove).not.toHaveBeenCalled()
})

it('元数据替换文档不取消渲染和清理，实际内容变化取消在途渲染', async () => {
  const owner = state.instances[0]
  state.add.mockImplementationOnce(async () => { owner.document = { ...owner.document } })
  expect((await renderVideoEditRenderCache(owner.document.id, { scope: 'all' })).cancelled).toBe(false)
  state.remove.mockImplementationOnce(async () => { owner.document = { ...owner.document }; return 1 })
  await clearVideoEditRenderCache(owner.document.id)
  state.add.mockImplementationOnce(async () => { owner.contentVersion!++ })
  expect((await renderVideoEditRenderCache(owner.document.id, { scope: 'all' })).cancelled).toBe(true)
})

it('needed 在指纹就绪后重新判断并过滤实时段，不创建编码会话', async () => {
  useFakeClock()
  const owner = state.instances[0]
  state.windows = [{ ...state.windows[0], fingerprintPending: true }]
  const started = vi.fn()
  const rendering = renderVideoEditRenderCache(owner.document.id, { scope: 'needed' }, undefined, started)
  await vi.advanceTimersByTimeAsync(1)
  expect(started).toHaveBeenCalledWith({ pendingWindows: 1, requestedFrames: 3, readyFrames: 0 })
  state.windows = [{ ...state.windows[0], heavy: false, fingerprintPending: false }]
  for (const listener of state.fingerprintListeners) listener()
  await vi.advanceTimersByTimeAsync(30)
  expect(await rendering).toMatchObject({ renderedWindows: 0, requestedFrames: 0, cancelled: false })
  expect(state.sessions).toBe(0)
})

it('仅导出读取预览不启动自动调度，也不使后台工程参加另一工程的自动渲染', async () => {
  useFakeClock(); vi.resetModules()
  const fresh = await import('./videoEditRenderCache')
  const first = state.instances[0] as (typeof state.instances)[number] & { activeSequenceId?: string }
  first.activeSequenceId = (state.composition as { id: string }).id
  const timers = vi.getTimerCount()
  await fresh.prepareVideoEditRenderWindows(first.document.id, state.composition as Parameters<typeof readyVideoEditRenderWindows>[1], new AbortController().signal)
  expect(vi.getTimerCount()).toBe(timers)
  await vi.advanceTimersByTimeAsync(5000)
  expect(state.sessions).toBe(0)
})

it('首次索引读取阶段取消后不再启动任务，删除同时中止等待声明的规划', async () => {
  useFakeClock(); vi.resetModules()
  const { renderVideoEditRenderCache, cancelVideoEditRenderCache, clearVideoEditRenderCache } = await import('./videoEditRenderCache')
  const owner = state.instances[0], index = deferred()
  state.list.mockImplementationOnce(async () => { await index.promise; return [] })
  const render = renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(1)
  await cancelVideoEditRenderCache(owner.document.id)
  expect(await render).toMatchObject({ cancelled: true })
  index.resolve(); await vi.advanceTimersByTimeAsync(1)
  expect(state.render).not.toHaveBeenCalled()

  const { VideoEditCodeMetadataPending } = await import('./videoEditCodeState')
  const declarations = deferred()
  let waiting = true
  state.fingerprints.mockImplementation(() => { if (waiting) throw new VideoEditCodeMetadataPending(declarations.promise); return undefined })
  const next = renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(1)
  const clearing = clearVideoEditRenderCache(owner.document.id)
  await vi.advanceTimersByTimeAsync(1)
  expect(await next).toMatchObject({ cancelled: true })
  waiting = false; declarations.resolve()
  await vi.advanceTimersByTimeAsync(1)
  await clearing
  expect(state.render).not.toHaveBeenCalled()
})

it('删除在首次索引读取阶段也响应取消，取消后不迟到删除或持续占用清理状态', async () => {
  useFakeClock()
  const owner = state.instances[0], index = deferred(), controller = new AbortController()
  state.list.mockImplementationOnce(async () => { await index.promise; return [] })
  const clearing = clearVideoEditRenderCache(owner.document.id, undefined, controller.signal)
  const rejected = expect(clearing).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(1)
  controller.abort(); await rejected
  index.resolve(); await vi.advanceTimersByTimeAsync(1)
  expect(state.remove).not.toHaveBeenCalled()
  expect((await renderVideoEditRenderCache(owner.document.id, { scope: 'all' })).cancelled).toBe(false)
})

 it('预渲染按实际来源登记，自动放行缓存、手动仍精确，旧条目保持可读', async () => {
  const projectId = state.instances[0].document.id
  state.render.mockResolvedValueOnce({ provenance: 'web-cache' })
  await renderVideoEditRenderCache(projectId, { scope: 'all', auto: true })
  expect(state.render.mock.calls.every(call => call[2] === 'web-cache')).toBe(true)
  expect(state.commit.mock.calls[0][0]).toMatchObject({ entry: { provenance: 'web-cache' } })
  const composition = state.composition as Parameters<typeof readyVideoEditRenderWindows>[1]
  expect(readyVideoEditRenderWindows(projectId, composition)[0]).toMatchObject({ provenance: 'web-cache' })
  state.render.mockClear()
  await renderVideoEditRenderCache(projectId, { scope: 'all' })
  expect(state.render.mock.calls.every(call => call[2] === 'exact')).toBe(true)
  expect(state.commit.mock.calls.at(-1)?.[0]).toMatchObject({ entry: { provenance: 'live' } })
})
