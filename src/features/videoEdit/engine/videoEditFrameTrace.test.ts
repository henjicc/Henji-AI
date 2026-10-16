import { afterEach, expect, it, vi } from 'vitest'
import { enableVideoEditFrameTrace, traceVideoEditFrame } from './videoEditFrameTrace'

afterEach(() => { enableVideoEditFrameTrace(false); vi.restoreAllMocks() })

it('生产默认不采样；巡检只保留 Chromium trace，不积累 PerformanceEntry', () => {
  const measure = vi.spyOn(performance, 'measure')
  traceVideoEditFrame('evaluate', 30, 1, 2)
  expect(measure).not.toHaveBeenCalled()
  enableVideoEditFrameTrace(true)
  traceVideoEditFrame('evaluate', 30, 1, 2)
  expect(measure).toHaveBeenCalledWith('henji.frame.evaluate:30', { start: 1, end: 2 })
  expect(performance.getEntriesByName('henji.frame.evaluate:30')).toEqual([])
  enableVideoEditFrameTrace(false)
  traceVideoEditFrame('evaluate', 31, 2, 3)
  expect(measure).toHaveBeenCalledTimes(1)
})
