import { afterEach, expect, it, vi } from 'vitest'
const logs = vi.hoisted(() => vi.fn())
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: logs }) }))
import { beginVideoEditFirstFrame, endVideoEditTiming, noteVideoEditWorkerTiming, recordVideoEditFirstFrame, releaseVideoEditFirstFrameWait, videoEditFirstFramePending, videoEditTimingContext, videoEditTimingEvent, whenVideoEditFirstFrame } from './videoEditFirstFrameTiming'
afterEach(() => { endVideoEditTiming('project'); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); logs.mockClear() })
it('只在打开窗口观察长任务，首帧后汇总并断开观察器', () => {
  vi.useFakeTimers()
  let time = 0
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  const disconnect = vi.fn()
  let receive!: (list: PerformanceObserverEntryList) => void
  vi.stubGlobal('PerformanceObserver', class {
    static supportedEntryTypes = ['longtask']
    constructor(callback: (list: PerformanceObserverEntryList) => void) { receive = callback }
    observe() {}
    takeRecords(): PerformanceEntry[] { return [] }
    disconnect = disconnect
  })
  beginVideoEditFirstFrame('project', 'sequence', 'open')
  time = 100
  recordVideoEditFirstFrame('project', 'sequence', {})
  receive({ getEntries: () => [{ startTime: 110, duration: 120 }] } as unknown as PerformanceObserverEntryList)
  vi.advanceTimersByTime(1000)
  expect(disconnect).toHaveBeenCalledOnce()
  expect(logs.mock.calls.at(-1)?.[1].context).toMatchObject({ longTaskCount: 1, postFirstFrameLongTaskCount: 1, postFirstFrameLongTaskMaxMs: 120 })
})
it('切换时拒绝旧序列回执，首帧只记录一次并在一秒后关闭窗口', () => {
  vi.useFakeTimers()
  beginVideoEditFirstFrame('project', 'old', 'open')
  beginVideoEditFirstFrame('project', 'next', 'switch')
  recordVideoEditFirstFrame('project', 'old', {})
  expect(logs.mock.calls.filter(([, meta]) => meta.event === 'video_edit.program.first_frame')).toHaveLength(0)
  recordVideoEditFirstFrame('project', 'next', { frame: 0 })
  recordVideoEditFirstFrame('project', 'next', { frame: 1 })
  expect(logs.mock.calls.filter(([, meta]) => meta.event === 'video_edit.program.first_frame')).toHaveLength(1)
  vi.advanceTimersByTime(1000)
  expect(videoEditTimingContext('project', 'next')).toBeUndefined()
  expect(logs.mock.calls.at(-1)?.[1].context.reason).toBe('presented')
})
it('失败超时或关闭项目均清理观察窗口', () => {
  vi.useFakeTimers()
  beginVideoEditFirstFrame('project', 'sequence', 'open')
  vi.advanceTimersByTime(30000)
  expect(videoEditTimingContext('project', 'sequence')).toBeUndefined()
  expect(logs.mock.calls.at(-1)?.[1].context.reason).toBe('timeout')
  beginVideoEditFirstFrame('project', 'sequence', 'open')
  endVideoEditTiming('project')
  expect(vi.getTimerCount()).toBe(0)
})
it('后台工作等首帧上屏才放行（切换序列时继续等新序列），首帧事件带分段耗时', async () => {
  vi.useFakeTimers()
  beginVideoEditFirstFrame('project', 'old', 'open')
  let started = false
  void whenVideoEditFirstFrame('project').then(() => { started = true })
  beginVideoEditFirstFrame('project', 'next', 'switch')
  const context = videoEditTimingContext('project', 'next')!
  videoEditTimingEvent(context, 'render.update.content', { durationMs: 40 })
  videoEditTimingEvent(context, 'render.update.fonts', { durationMs: 2400 })
  noteVideoEditWorkerTiming('video_edit.render.native.openDecoder', { ...context, durationMs: 300 })
  noteVideoEditWorkerTiming('video_edit.render.compositor.device', { ...context, durationMs: 200 })
  await Promise.resolve(); expect(started).toBe(false); expect(videoEditFirstFramePending('project')).toBe(true)
  recordVideoEditFirstFrame('project', 'next', { decodeMs: 2500, gpuMs: 34, renderStages: { codeReady: 900 } })
  await Promise.resolve(); expect(started).toBe(true); expect(videoEditFirstFramePending('project')).toBe(false)
  const first = logs.mock.calls.find(([, meta]) => meta.event === 'video_edit.program.first_frame')![1].context
  expect(first.phases).toMatchObject({ contentCheck: 40, fonts: 2400, code: 900, decoderSession: 300, firstDecode: 2500, gpu: 234 })
  await expect(whenVideoEditFirstFrame('project')).resolves.toBeUndefined()
})
it('首帧已知来不了（面板隐藏、渲染失败）时立即放行后台任务，只放行本工程，首帧来了照常记录', async () => {
  vi.useFakeTimers()
  beginVideoEditFirstFrame('project', 'sequence', 'open'); beginVideoEditFirstFrame('other', 'sequence', 'open')
  let started = false
  void whenVideoEditFirstFrame('project').then(() => { started = true })
  releaseVideoEditFirstFrameWait('project', 'hidden'); await Promise.resolve()
  expect(started).toBe(true); expect(videoEditFirstFramePending('project')).toBe(false); expect(videoEditFirstFramePending('other')).toBe(true)
  recordVideoEditFirstFrame('project', 'sequence', {})
  expect(logs.mock.calls.some(([, meta]) => meta.event === 'video_edit.program.first_frame')).toBe(true)
  endVideoEditTiming('other')
})
