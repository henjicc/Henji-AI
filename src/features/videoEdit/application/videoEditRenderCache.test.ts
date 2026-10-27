import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { renderVideoEditRenderCache, readVideoEditRenderCache, recordVideoEditProgramRender, readyVideoEditRenderWindows, peekVideoEditRenderCache, requestVideoEditRenderBarWindows, subscribeVideoEditRenderBar } from './videoEditRenderCache'

type TestWindow = { key: string; startFrame: number; endFrame: number; heavy: boolean }
const state = vi.hoisted(() => ({
  instances: [] as Array<{ document: { id: string }; playing: boolean; scrubbing: boolean; busy: boolean; playbackDirection?: number; frame?: number }>,
  composition: {} as unknown,
  windows: [{ key: 'window', startFrame: 0, endFrame: 3, heavy: true }] as TestWindow[],
  render: vi.fn(async (..._args: unknown[]) => {}), dispose: vi.fn(async () => {}), add: vi.fn(async () => {}),
  discard: vi.fn(async () => {}), commit: vi.fn(async (..._args: unknown[]) => ({})), cancel: vi.fn(async () => {}),
  sessions: 0, viewListeners: new Set<() => void>(), events: [] as string[],
  windowSet: vi.fn((..._args: unknown[]): { signature: string; windows: TestWindow[] } => ({ signature: 'test', windows: state.windows })),
}))
vi.mock('mediabunny', () => ({
  CanvasSource: class { add = state.add }, Mp4OutputFormat: class {}, StreamTarget: class {},
  Output: class { addVideoTrack() {} async start() {} async finalize() {} cancel = state.cancel },
}))
vi.mock('@/core/logging', () => ({ createLogger: () => {
  const record = (_message: string, entry?: { event?: string }): void => { if (entry?.event) state.events.push(entry.event) }
  return { info: vi.fn(record), warn: vi.fn(record) }
} }))
vi.mock('@/services/mediaCache/mediaCacheSettings', () => ({ getMediaCacheSettings: () => ({}), subscribeMediaCacheSettings: () => () => {} }))
vi.mock('@/services/mediaCache/hardwareCapabilities', () => ({ resolveRenderCacheCodec: () => 'h264' }))
vi.mock('@/core/videoEdit/renderBitrate', () => ({ videoEditRenderEncoding: () => ({ profile: 'test', codec: 'h264' }) }))
vi.mock('@/core/videoEdit/renderCache', () => ({ VIDEO_EDIT_RENDER_CACHE_VERSION: 2, videoEditRenderWindowSet: (...args: unknown[]) => state.windowSet(...args) }))
vi.mock('@/platform/fonts', () => ({ fontLibrarySnapshot: () => ({ revision: 0 }) }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ settings: { get: async () => undefined, set: async () => {} }, mediaCache: {
  renderList: async () => [], renderRemove: async () => 0, renderBegin: async () => 'temporary', renderCommit: state.commit, renderDiscard: state.discard,
} }) }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class { canvas = {}; render = state.render; dispose = state.dispose; setSmartRegions() {} setTracks() {} constructor() { state.sessions++ } } }))
vi.mock('../engine/videoEditExportEncoder', () => ({ videoEditExportVideoOptions: () => ({}) }))
vi.mock('./videoEditTracking', () => ({ subscribeVideoEditTracking: () => () => {}, videoEditTrackResults: () => ({}), waitVideoEditTracking: async () => {} }))
vi.mock('./videoEditSmartRegions', () => ({ subscribeVideoEditSmartRegions: () => () => {}, videoEditSmartRegionSegments: () => ({}), waitVideoEditSmartRegions: async () => ({}) }))
vi.mock('./videoEditService', () => ({
  listVideoEditInstances: () => state.instances, requireVideoEditInstance: () => state.instances[0],
  getActiveVideoEditSequence: () => state.composition, findActiveVideoEditSequence: () => state.composition, publishVideoEdit: vi.fn(),
  subscribeVideoEditView: (listener: () => void) => { state.viewListeners.add(listener); return () => { state.viewListeners.delete(listener) } },
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
  const document = createVideoEditTestDocument('预渲染生命周期')
  state.composition = videoEditComposition(document, document.sequences[0].id)
  state.instances = [{ document, playing: false, scrubbing: false, busy: false, frame: 0 }]
  state.add.mockImplementation(async () => {}); state.render.mockImplementation(async () => {})
  state.windows = [{ key: document.id, startFrame: 0, endFrame: 3, heavy: true }]
  state.commit.mockImplementation(async (...args: unknown[]) => ({ ...(args[0] as { entry: object }).entry, path: 'preview.mp4', bytes: 10 }))
  state.sessions = 0; state.viewListeners.clear(); state.events = []
})
afterEach(() => { vi.useRealTimers() })

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
it('自动预渲染：用户停播后 10 秒内不开始，以免刚开始就撞上紧接着的起播', async () => {
  useFakeClock()
  vi.resetModules()
  const fresh = await import('./videoEditRenderCache')
  const owner = state.instances[0] as (typeof state.instances)[number] & { activeSequenceId?: string }
  owner.activeSequenceId = (state.composition as { id: string }).id
  fresh.readVideoEditRenderCache(owner.document.id)
  owner.playing = true; publishView()
  await vi.advanceTimersByTimeAsync(4000)
  owner.playing = false; publishView()
  await vi.advanceTimersByTimeAsync(9500)
  expect(state.render).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1500)
  expect(state.render).toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(100)
  expect(state.commit).toHaveBeenCalledOnce()
  state.instances = []; await vi.advanceTimersByTimeAsync(1000)
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

it('渲染条重绘不分段：内容变了先给上一次的读数并标为过期，空闲时只算最新内容，算完通知渲染条', async () => {
  useFakeClock()
  const owner = state.instances[0] as (typeof state.instances)[number] & { activeSequenceId?: string }, projectId = owner.document.id
  // 当前序列与节目、渲染条共用同一份合成：加载缓存时的回收不另算一遍。
  owner.activeSequenceId = (state.composition as { id: string }).id
  expect(peekVideoEditRenderCache(projectId)).toEqual({ view: null, current: false })
  expect(state.windowSet).not.toHaveBeenCalled()
  const notified = vi.fn(); const stop = subscribeVideoEditRenderBar(notified)
  requestVideoEditRenderBarWindows(projectId); requestVideoEditRenderBarWindows(projectId)
  expect(state.windowSet).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(0)
  expect(state.windowSet).toHaveBeenCalledOnce(); expect(notified).toHaveBeenCalledOnce()
  const first = peekVideoEditRenderCache(projectId)
  expect(first.current).toBe(true); expect(first.view?.windows.map(window => window.startFrame)).toEqual([0])
  // 新的文档快照：重绘拿到上一次的读数，不分段。
  state.composition = { ...(state.composition as object) }; state.windows = [{ key: 'moved', startFrame: 30, endFrame: 33, heavy: true }]
  expect(peekVideoEditRenderCache(projectId)).toEqual({ view: first.view, current: false })
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
