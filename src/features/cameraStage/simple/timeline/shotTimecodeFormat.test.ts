import { describe, expect, it } from 'vitest'
import { formatShotTimecode, nextShotTimecodeMode } from './shotTimecodeFormat'

const FPS = 30

describe('formatShotTimecode', () => {
  it('纯秒格式保留两位小数', () => {
    expect(formatShotTimecode(4.2, 'seconds', FPS)).toBe('4.20s')
    expect(formatShotTimecode(0, 'seconds', FPS)).toBe('0.00s')
  })

  it('纯帧格式四舍五入到帧', () => {
    expect(formatShotTimecode(4, 'frames', FPS)).toBe('120f')
    expect(formatShotTimecode(4.23, 'frames', FPS)).toBe('127f')
  })

  it('秒:帧格式为 hh:mm:ss:ff 四段', () => {
    expect(formatShotTimecode(4.2333, 'secondsFrames', FPS)).toBe('00:00:04:07')
    expect(formatShotTimecode(0, 'secondsFrames', FPS)).toBe('00:00:00:00')
    expect(formatShotTimecode(65, 'secondsFrames', FPS)).toBe('00:01:05:00')
    expect(formatShotTimecode(3661, 'secondsFrames', FPS)).toBe('01:01:01:00')
  })

  it('负数钳制到 0', () => {
    expect(formatShotTimecode(-5, 'seconds', FPS)).toBe('0.00s')
    expect(formatShotTimecode(-5, 'frames', FPS)).toBe('0f')
  })
})

describe('nextShotTimecodeMode', () => {
  it('按 秒 → 帧 → 秒:帧 → 秒 循环', () => {
    expect(nextShotTimecodeMode('seconds')).toBe('frames')
    expect(nextShotTimecodeMode('frames')).toBe('secondsFrames')
    expect(nextShotTimecodeMode('secondsFrames')).toBe('seconds')
  })
})
