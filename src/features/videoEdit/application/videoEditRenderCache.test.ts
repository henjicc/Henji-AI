import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { renderVideoEditRenderCache, readVideoEditRenderCache, recordVideoEditProgramRender, readyVideoEditRenderWindows } from './videoEditRenderCache'

const state = vi.hoisted(() => ({
  instances: [] as Array<{ document: { id: string }; playing: boolean; scrubbing: boolean; busy: boolean; playbackDirection?: number }>,
  composition: {} as unknown,
  windows: [{ key: 'window', startFrame: 0, endFrame: 3, heavy: true }],
  render: vi.fn(async () => {}), dispose: vi.fn(async () => {}), add: vi.fn(async () => {}),
  discard: vi.fn(async () => {}), commit: vi.fn(async () => ({})), cancel: vi.fn(async () => {}),
}))
vi.mock('mediabunny', () => ({
  CanvasSource: class { add = state.add }, Mp4OutputFormat: class {}, StreamTarget: class {},
  Output: class { addVideoTrack() {} async start() {} async finalize() {} cancel = state.cancel },
}))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }))
vi.mock('@/services/mediaCache/mediaCacheSettings', () => ({ getMediaCacheSettings: () => ({}), subscribeMediaCacheSettings: () => () => {} }))
vi.mock('@/services/mediaCache/hardwareCapabilities', () => ({ resolveRenderCacheCodec: () => 'h264' }))
vi.mock('@/core/videoEdit/renderBitrate', () => ({ videoEditRenderEncoding: () => ({ profile: 'test', codec: 'h264' }) }))
vi.mock('@/core/videoEdit/renderCache', () => ({ VIDEO_EDIT_RENDER_CACHE_VERSION: 2, videoEditRenderWindows: () => state.windows }))
vi.mock('@/platform/fonts', () => ({ fontLibrarySnapshot: () => ({ revision: 0 }) }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ settings: { get: async () => undefined, set: async () => {} }, mediaCache: {
  renderList: async () => [], renderRemove: async () => 0, renderBegin: async () => 'temporary', renderCommit: state.commit, renderDiscard: state.discard,
} }) }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class { canvas = {}; render = state.render; dispose = state.dispose; setSmartRegions() {} setTracks() {} } }))
vi.mock('../engine/videoEditExportEncoder', () => ({ videoEditExportVideoOptions: () => ({}) }))
vi.mock('./videoEditTracking', () => ({ subscribeVideoEditTracking: () => () => {}, videoEditTrackResults: () => ({}), waitVideoEditTracking: async () => {} }))
vi.mock('./videoEditSmartRegions', () => ({ subscribeVideoEditSmartRegions: () => () => {}, videoEditSmartRegionSegments: () => ({}), waitVideoEditSmartRegions: async () => ({}) }))
vi.mock('./videoEditService', () => ({
  listVideoEditInstances: () => state.instances, requireVideoEditInstance: () => state.instances[0],
  getActiveVideoEditSequence: () => state.composition, findActiveVideoEditSequence: () => state.composition, publishVideoEdit: vi.fn(),
}))
beforeEach(() => {
  vi.clearAllMocks()
  const document = createVideoEditTestDocument('预渲染生命周期')
  state.composition = videoEditComposition(document, document.sequences[0].id)
  state.instances = [{ document, playing: false, scrubbing: false, busy: false }]
  state.add.mockImplementation(async () => {})
  state.windows = [{ key: document.id, startFrame: 0, endFrame: 3, heavy: true }]
  state.commit.mockImplementation(async (...args: unknown[]) => ({ ...(args[0] as { entry: object }).entry, path: 'preview.mp4', bytes: 10 }))
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
it('其他实例播放时也让出显卡，暂停后继续同一预渲染窗口', async () => {
  vi.useFakeTimers()
  const owner = state.instances[0], other = { ...owner, playing: true }
  state.instances.push(other)
  const pending = renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(200)
  expect(state.render).not.toHaveBeenCalled()
  other.playing = false
  await vi.advanceTimersByTimeAsync(100)
  expect(await pending).toMatchObject({ cancelled: false, renderedWindows: 1 })
  expect(state.render).toHaveBeenCalledTimes(3); expect(state.commit).toHaveBeenCalledOnce()
})
it('等待前台播放时关闭原实例，及时取消并释放会话', async () => {
  vi.useFakeTimers()
  const owner = state.instances[0]; owner.playing = true
  const pending = renderVideoEditRenderCache(owner.document.id, { scope: 'all' })
  await vi.advanceTimersByTimeAsync(100); state.instances = []
  await vi.advanceTimersByTimeAsync(100)
  expect(await pending).toMatchObject({ cancelled: true })
  expect(state.render).not.toHaveBeenCalled(); expect(state.dispose).toHaveBeenCalledOnce()
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
