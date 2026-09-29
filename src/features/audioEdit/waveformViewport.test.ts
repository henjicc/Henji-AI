import { expect, it } from 'vitest'
import { clampViewport, sampleWaveform, waveformReference, zoomViewport } from './waveformViewport'

it('zooms around the cursor, clamps panning and supports fit-to-duration', () => {
  expect(zoomViewport({ start: 0, end: 1000 }, 0.25, 0.5, 1000, 10)).toEqual({ start: 125, end: 625 })
  expect(clampViewport(-100, 500, 1000)).toEqual({ start: 0, end: 500 })
  expect(clampViewport(800, 500, 1000)).toEqual({ start: 500, end: 1000 })
  expect(zoomViewport({ start: 125, end: 625 }, 0.25, 5, 1000, 10)).toEqual({ start: 0, end: 1000 })
})
it('preserves the tail of short peak arrays and normalizes quiet audio with a stable reference', () => {
  expect(sampleWaveform([0.01, 0.02], { start: 0, end: 100 }, 100, 10, 0.02).at(-1)).toBe(1)
  const peaks = [0.001, 0.002, 0.003, 0.004, 0.005]
  const reference = waveformReference(peaks)
  expect(sampleWaveform(peaks, { start: 20, end: 40 }, 100, 1, reference)).toEqual([0.4])
  expect(sampleWaveform(peaks, { start: 0, end: 100 }, 100, 5, reference)).toEqual([0.2, 0.4, 0.6, 0.8, 1])
  expect(sampleWaveform([], { start: 0, end: 100 }, 100, 10, 1)).toEqual([])
})
