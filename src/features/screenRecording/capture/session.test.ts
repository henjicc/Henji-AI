import { beforeEach, expect, it, vi } from 'vitest'
import type { CaptureCommand, CaptureRequest } from '@/core/screenRecording/capture'
import { captureOptionsSchema } from '@/core/screenRecording/capture'

const state = vi.hoisted(() => ({ command: undefined as ((command: CaptureCommand) => void) | undefined, backend: 'gfxcapture', capture: vi.fn(), detach: vi.fn(), track: { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), cancel: vi.fn(), snapshot: vi.fn(() => ({ tracks: [] })) }, screen: { prepare: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), cancel: vi.fn() }, options: undefined as { originUs: number } | undefined }))
vi.mock('@/platform', () => ({ getPlatform: () => ({ screenRecording: { capture: state.capture, onCaptureCommand: (handler: typeof state.command) => { state.command = handler; return state.detach } } }) }))
vi.mock('./chromium', () => ({ ChromiumCaptureBackend: class { constructor() { return state.screen } } }))
vi.mock('../tracks/session', () => ({ RecordingTracksSession: class { constructor(options: { originUs: number }) { state.options = options; return state.track } } }))
import { prepareScreenCapture } from './session'

const id = '00000000-0000-4000-8000-000000000001'
const options = captureOptionsSchema.parse({ sourceId: 'screen:1:0', width: 1920, height: 1080, fps: 30, bitrate: 12000000 })
beforeEach(() => { vi.clearAllMocks(); state.backend = 'gfxcapture'; state.capture.mockImplementation(async (request: CaptureRequest) => request.operation === 'prepare' ? { sessionId: id, backend: state.backend, originUs: 123456, directory: '/recording', options } : undefined) })
it.each(['gfxcapture', 'chromium'])('%s 等待全部轨道和文档检查点后才确认停止，共用主时钟原点', async backend => {
  state.backend = backend
  const session = await prepareScreenCapture(id, options, { name: '课程', tracks: { microphone: {}, systemAudio: false } })
  expect(state.options?.originUs).toBe(123456)
  let complete!: () => void
  state.track.stop.mockReturnValueOnce(new Promise<void>(resolve => { complete = resolve }))
  state.command!({ sessionId: id, requestId: 'stop', operation: 'stop' })
  await Promise.resolve()
  expect(state.capture).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'ack' }))
  complete()
  await vi.waitFor(() => expect(state.capture).toHaveBeenCalledWith({ operation: 'ack', sessionId: id, requestId: 'stop' }))
  expect(state.capture.mock.calls.findIndex(([request]) => request.operation === 'tracks')).toBeLessThan(state.capture.mock.calls.findIndex(([request]) => request.operation === 'ack'))
  expect(state.screen.stop).toHaveBeenCalledTimes(backend === 'chromium' ? 1 : 0)
  await session.close()
  expect(state.track.cancel).toHaveBeenCalled(); expect(state.detach).toHaveBeenCalled()
})
it('轨道停止失败返回错误；关闭失败仍释放所有本地设备和订阅', async () => {
  state.backend = 'chromium'
  const session = await prepareScreenCapture(id, options, { name: '课程', tracks: { systemAudio: false } })
  state.track.stop.mockRejectedValueOnce(new Error('写盘失败'))
  state.command!({ sessionId: id, requestId: 'stop', operation: 'stop' })
  await vi.waitFor(() => expect(state.capture).toHaveBeenCalledWith(expect.objectContaining({ operation: 'ack', error: expect.stringContaining('写盘失败') })))
  state.capture.mockRejectedValueOnce(new Error('窗口失联'))
  await expect(session.close()).rejects.toThrow('窗口失联')
  expect(state.track.cancel).toHaveBeenCalled(); expect(state.screen.cancel).toHaveBeenCalled(); expect(state.detach).toHaveBeenCalled()
})
