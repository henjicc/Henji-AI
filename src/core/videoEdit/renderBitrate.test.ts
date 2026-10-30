import { describe, expect, it } from 'vitest'
import { renderBitrateMbps, videoEditRenderEncoding } from './renderBitrate'

const avc = (width: number, height: number, fps: number): number => renderBitrateMbps({ width, height, fps, codec: 'avc', quality: 'standard' })
const hevc = (width: number, height: number, fps: number): number => renderBitrateMbps({ width, height, fps, codec: 'hevc', quality: 'standard' })

describe('render bitrate table', () => {
  it('returns every table entry for H.264', () => {
    expect(avc(3840, 2160, 60)).toBe(50)
    expect(avc(3840, 2160, 30)).toBe(40)
    expect(avc(2560, 1440, 60)).toBe(30)
    expect(avc(2560, 1440, 30)).toBe(25)
    expect(avc(1920, 1080, 60)).toBe(20)
    expect(avc(1920, 1080, 30)).toBe(20)
  })
  it('interpolates by pixel count and by frame rate between 30 and 60', () => {
    // Halfway between 1440p and 4K in pixels at 60fps: (30 + 50) / 2.
    const pixels = (2560 * 1440 + 3840 * 2160) / 2
    expect(avc(pixels, 1, 60)).toBe(40)
    expect(avc(3840, 2160, 45)).toBe(45)
    expect(avc(2560, 1440, 50)).toBeCloseTo(28.3, 1)
    expect(avc(3840, 2160, 59.94)).toBeCloseTo(50, 1)
    expect(avc(3840, 2160, 24)).toBe(40)
  })
  it('never goes below 20Mbps, including small sizes and HEVC', () => {
    expect(avc(1280, 720, 30)).toBe(20)
    expect(avc(640, 360, 24)).toBe(20)
    expect(hevc(1920, 1080, 60)).toBe(20)
    expect(hevc(2560, 1440, 30)).toBe(20)
    expect(hevc(3840, 2160, 60)).toBe(35)
    expect(hevc(3840, 2160, 30)).toBe(28)
  })
  it('raises above 60fps proportionally up to twice the 60fps tier', () => {
    expect(avc(3840, 2160, 120)).toBe(100)
    expect(avc(3840, 2160, 240)).toBe(100)
    expect(avc(2560, 1440, 90)).toBe(45)
    expect(avc(1920, 1080, 120)).toBe(40)
  })
  it('scales above 4K by pixel count and applies the high quality factor last', () => {
    expect(avc(7680, 4320, 60)).toBe(200)
    expect(renderBitrateMbps({ width: 3840, height: 2160, fps: 60, codec: 'avc', quality: 'high' })).toBe(65)
    expect(renderBitrateMbps({ width: 1920, height: 1080, fps: 30, codec: 'hevc', quality: 'high' })).toBe(26)
  })
})

describe('render encoding', () => {
  it('缓存关键帧间隔对应一帧的时长', () => {
    const encoding = videoEditRenderEncoding({ width: 3840, height: 2160, fps: 60 }, 'hevc', 'standard')
    expect(encoding).toMatchObject({ codec: 'hevc', bitrateMbps: 35, bitrateMode: 'vbr', encoderPreference: 'hardware', keyframeInterval: 1 / 60 })
    expect(videoEditRenderEncoding({ width: 1920, height: 1080, fps: 30000 / 1001 }, 'avc', 'high').keyframeInterval).toBeCloseTo(1001 / 30000)
  })
})
