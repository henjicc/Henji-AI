import { expect, it } from 'vitest'
import { captureClockCorrelation, CaptureSourceClock } from './clockSync'
import { recordingTrackPlacement } from '../screenRecording/tracks'

it('共享时钟桥消除两个进程的原点差，往返误差保留为不确定度', () => {
  expect(captureClockCorrelation({ beforeMs: 20, afterMs: 24, mainUs: 10_022_000 }, 10_000_000)).toEqual({ originMs: 0, uncertaintyUs: 2000 })
  expect(() => captureClockCorrelation({ beforeMs: 24, afterMs: 20, mainUs: 1 }, 0)).toThrow('校准无效')
})
it('60分钟摄像头设备漂移按5秒校准；量子内靠近新偏移且时间不倒退', () => {
  const quantum = 1_000_000 / 60; const clock = new CaptureSourceClock(quantum)
  let previous = -1
  for (let index = 0; index < 60 * 60 * 60; index++) {
    const wallUs = index * quantum
    const mapped = clock.map(wallUs * 1.00006 + 800_000, wallUs + 10_000)
    expect(mapped.monoUs).toBeGreaterThan(previous)
    expect(Math.abs(mapped.monoUs - (wallUs + 10_000))).toBeLessThan(1000)
    previous = mapped.monoUs
  }
})
it('校准突变不超过一个量子，投递延迟不伪装精确采集时间，剪辑按墙钟定位空档', () => {
  const clock = new CaptureSourceClock(16667)
  const first = clock.map(100, 1000)
  const next = clock.map(5_000_100, 5_200_000)
  expect(Math.abs(first.offsetUs - next.offsetUs)).toBeLessThanOrEqual(16667)
  expect(next.uncertaintyUs).toBeGreaterThan(180_000)
  expect(recordingTrackPlacement({ id: 'test', file: 'test.mp4', monoSpanUs: [2_250_000, 3_250_000], units: 60, latencyCompensationUs: 0, anchors: [] }, 250_000, 60)).toEqual({ startFrame: 120, durationFrames: 60 })
})
