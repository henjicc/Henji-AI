import { afterEach, expect, it, vi } from 'vitest'
const logs = vi.hoisted(() => vi.fn())
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: logs }) }))
import { beginVideoEditFirstFrame, endVideoEditTiming, recordVideoEditFirstFrame, videoEditTimingContext } from './videoEditFirstFrameTiming'
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
