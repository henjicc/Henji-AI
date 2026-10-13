import { expect, it } from 'vitest'
import { correlateRecordingClock } from './recordingClock'

it('输出呈现相关点换算到输入采集，蓝牙高延迟不会被标成精确', () => {
  const input = { originMs: 0, beforeMs: 1000, afterMs: 1000.2, currentSeconds: 1,
    timestamp: { contextTime: 1, performanceTime: 1000 }, sampleRate: 48000, baseLatency: .01, inputLatency: .02, outputLatency: .2 }
  const result = correlateRecordingClock(input)
  expect(result.offsetUs).toBe(-220000)
  expect(result.uncertaintyUs).toBeGreaterThan(200000)
  expect(result.trusted).toBe(true)
  const unknown = { ...input, outputLatency: undefined }
  expect(correlateRecordingClock(unknown)).toMatchObject({ trusted: false })
  expect(correlateRecordingClock(unknown).uncertaintyUs).toBeGreaterThan(50000)
})
