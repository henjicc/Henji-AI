import { describe, expect, it } from 'vitest'
import { amplitudeTicks, brushRadius, formatTimecode, frameAtX, hzAtY, normalizeSpectralSelection, normalizeTimeSelection, strokeBounds, timeTickStep, xAtFrame, yAtHz, zoomAmplitude, zoomFrequency, zoomTime } from './spectralEditorModel'

const view = { start: 1000, end: 3000 }
const frequency = { minHz: 20, maxHz: 20000, scale: 'log' as const }

describe('音频编辑区交互模型', () => {
  it('像素与采样帧、频率互相换算', () => {
    expect(frameAtX(50, 100, view)).toBe(2000)
    expect(xAtFrame(2000, 100, view)).toBe(50)
    expect(hzAtY(yAtHz(1000, 300, frequency), 300, frequency)).toBeCloseTo(1000, 3)
    expect(yAtHz(20000, 300, frequency)).toBeCloseTo(0)
  })

  it('时间缩放以指针为中心、不超出素材', () => {
    const zoomedIn = zoomTime(view, 0.25, -100, 48000, 128)
    expect(zoomedIn.end - zoomedIn.start).toBeLessThan(2000)
    // 指针下的帧保持不动。
    expect(frameAtX(25, 100, zoomedIn)).toBeCloseTo(1500, 0)
    const zoomedOut = zoomTime({ start: 0, end: 48000 }, 0.5, 2000, 48000, 128)
    expect(zoomedOut).toEqual({ start: 0, end: 48000 })
  })

  it('振幅与频率缩放有上下限', () => {
    expect(zoomAmplitude(1, 1000)).toBe(1)
    expect(zoomAmplitude(1, -100)).toBeGreaterThan(1)
    expect(zoomAmplitude(60, -1000)).toBe(64)
    const narrowed = zoomFrequency(frequency, 0.5, -200, 0, 24000)
    expect(narrowed.maxHz / narrowed.minHz).toBeLessThan(1000)
    let widened = narrowed
    for (let step = 0; step < 40; step++) widened = zoomFrequency(widened, 0.5, 10000, 0, 24000)
    expect(widened.minHz).toBeCloseTo(20); expect(widened.maxHz).toBeCloseTo(24000)
  })

  it('选区按任意方向拖动都规整成从小到大，并夹在素材内', () => {
    expect(normalizeTimeSelection(500, -20, 400)).toEqual({ start: 0, end: 400 })
    expect(normalizeSpectralSelection({ frame: 30, hz: 9000 }, { frame: 10, hz: 200 }, 100, 8000)).toEqual({ start: 10, end: 30, lowHz: 200, highHz: 8000 })
  })

  it('画笔半径与缩放无关，笔画包围框带上半径', () => {
    const radius = brushRadius(10, 100, 100, { start: 0, end: 1000 }, { minHz: 20, maxHz: 20480, scale: 'log' })
    expect(radius.radiusFrames).toBe(100)
    expect(radius.radiusOctaves).toBeCloseTo(1, 5)
    expect(strokeBounds({ points: [{ frame: 500, hz: 1000 }, { frame: 700, hz: 2000 }], radiusFrames: 50, radiusOctaves: 1 }, 1000, 24000)).toEqual({ start: 450, end: 750, lowHz: 500, highHz: 4000 })
  })

  it('dB 刻度随振幅放大出现更安静的刻度，且彼此不挤', () => {
    expect(amplitudeTicks(1).map(tick => tick.db)).toEqual([-6, -12])
    const zoomed = amplitudeTicks(8)
    expect(zoomed[0].db).toBeLessThanOrEqual(-24)
    for (let index = 1; index < zoomed.length; index++) expect(zoomed[index - 1].amplitude - zoomed[index].amplitude).toBeGreaterThanOrEqual(0.18)
  })

  it('时间刻度步长与时间码', () => {
    expect(timeTickStep({ start: 0, end: 48000 * 60 }, 600, 48000)).toBe(48000 * 10)
    expect(formatTimecode(48000 * 61.5, 48000)).toBe('1:01.500')
    expect(formatTimecode(48000 * 61.5, 48000, 48000 * 10)).toBe('1:02')
  })
})
