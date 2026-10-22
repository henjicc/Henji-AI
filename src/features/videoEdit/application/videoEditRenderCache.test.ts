import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { renderVideoEditRenderCache } from './videoEditRenderCache'

const state = vi.hoisted(() => ({
  instances: [] as Array<{ document: { id: string }; playing: boolean; scrubbing: boolean; busy: boolean }>,
  composition: {} as unknown,
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
vi.mock('@/core/videoEdit/renderCache', () => ({ videoEditRenderWindows: () => [{ key: 'window', startFrame: 0, endFrame: 3, heavy: true }] }))
vi.mock('@/platform/fonts', () => ({ fontLibrarySnapshot: () => ({ revision: 0 }) }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ mediaCache: {
  renderList: async () => [], renderRemove: async () => 0, renderBegin: async () => 'temporary', renderCommit: state.commit, renderDiscard: state.discard,
} }) }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class { canvas = {}; render = state.render; dispose = state.dispose; setSmartRegions() {} setTracks() {} } }))
vi.mock('../engine/videoEditExportEncoder', () => ({ videoEditExportVideoOptions: () => ({}) }))
vi.mock('./videoEditTracking', () => ({ videoEditTrackResults: () => ({}), waitVideoEditTracking: async () => {} }))
vi.mock('./videoEditSmartRegions', () => ({ videoEditSmartRegionSegments: () => ({}), waitVideoEditSmartRegions: async () => ({}) }))
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
