import { describe, expect, it } from 'vitest'
import { formatCompactStateKeyframeTimecode, formatStateKeyframeTimecode, nextStateKeyframeTimecodeMode } from './stateKeyframeTimecodeFormat'

const FPS = 30

describe('formatStateKeyframeTimecode', () => {
  it('纯秒格式保留两位小数', () => {
    expect(formatStateKeyframeTimecode(4.2, 'seconds', FPS)).toBe('4.20s')
    expect(formatStateKeyframeTimecode(0, 'seconds', FPS)).toBe('0.00s')
  })

  it('纯帧格式四舍五入到帧', () => {
    expect(formatStateKeyframeTimecode(4, 'frames', FPS)).toBe('120f')
    expect(formatStateKeyframeTimecode(4.23, 'frames', FPS)).toBe('127f')
  })

  it('秒:帧格式为 hh:mm:ss:ff 四段', () => {
    expect(formatStateKeyframeTimecode(4.2333, 'secondsFrames', FPS)).toBe('00:00:04:07')
    expect(formatStateKeyframeTimecode(0, 'secondsFrames', FPS)).toBe('00:00:00:00')
    expect(formatStateKeyframeTimecode(65, 'secondsFrames', FPS)).toBe('00:01:05:00')
    expect(formatStateKeyframeTimecode(3661, 'secondsFrames', FPS)).toBe('01:01:01:00')
  })

  it('负数钳制到 0', () => {
    expect(formatStateKeyframeTimecode(-5, 'seconds', FPS)).toBe('0.00s')
    expect(formatStateKeyframeTimecode(-5, 'frames', FPS)).toBe('0f')
  })
})

describe('formatCompactStateKeyframeTimecode', () => {
  it('省略为零的高位时间单位', () => {
    expect(formatCompactStateKeyframeTimecode(2, 'secondsFrames', FPS)).toBe('02:00')
    expect(formatCompactStateKeyframeTimecode(65, 'secondsFrames', FPS)).toBe('01:05:00')
    expect(formatCompactStateKeyframeTimecode(3661, 'secondsFrames', FPS)).toBe('01:01:01:00')
  })

  it('其他模式沿用对应单位格式', () => {
    expect(formatCompactStateKeyframeTimecode(2, 'seconds', FPS)).toBe('2.00s')
    expect(formatCompactStateKeyframeTimecode(2, 'frames', FPS)).toBe('60f')
  })
})

describe('nextStateKeyframeTimecodeMode', () => {
  it('按 秒 → 帧 → 秒:帧 → 秒 循环', () => {
    expect(nextStateKeyframeTimecodeMode('seconds')).toBe('frames')
    expect(nextStateKeyframeTimecodeMode('frames')).toBe('secondsFrames')
    expect(nextStateKeyframeTimecodeMode('secondsFrames')).toBe('seconds')
  })
})
