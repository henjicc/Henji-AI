import { describe, expect, it } from 'vitest'
import { renderBitrateMbps } from './renderBitrate'

describe('render bitrate', () => {
  it('scales from H.264 4K60 40Mbps by pixel rate^0.75 with a 6Mbps floor', () => {
    const avc = (width: number, height: number, fps: number): number => renderBitrateMbps({ width, height, fps, codec: 'avc', quality: 'standard' })
    expect(avc(3840, 2160, 60)).toBe(40)
    expect(avc(3840, 2160, 30)).toBeCloseTo(23.8, 1)
    expect(avc(2560, 1440, 60)).toBeCloseTo(21.8, 1)
    expect(avc(1920, 1080, 60)).toBeCloseTo(14.1, 1)
    expect(avc(1920, 1080, 30)).toBeCloseTo(8.4, 1)
    expect(avc(640, 360, 30)).toBe(6)
  })
  it('applies the HEVC and high quality factors', () => {
    expect(renderBitrateMbps({ width: 3840, height: 2160, fps: 60, codec: 'hevc', quality: 'standard' })).toBe(26)
    expect(renderBitrateMbps({ width: 3840, height: 2160, fps: 60, codec: 'avc', quality: 'high' })).toBe(60)
  })
})
