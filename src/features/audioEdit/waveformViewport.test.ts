import { expect, it } from 'vitest'
import { AUDIO_EDIT_MIN_VIEW_FRAMES, clampViewport, zoomViewport } from './waveformViewport'

it('zooms around the cursor, clamps panning and supports fit-to-duration', () => {
  expect(zoomViewport({ start: 0, end: 1000 }, 0.25, 0.5, 1000, 10)).toEqual({ start: 125, end: 625 })
  expect(clampViewport(-100, 500, 1000)).toEqual({ start: 0, end: 500 })
  expect(clampViewport(800, 500, 1000)).toEqual({ start: 500, end: 1000 })
  expect(zoomViewport({ start: 125, end: 625 }, 0.25, 5, 1000, 10)).toEqual({ start: 0, end: 1000 })
})
it('zooms down to sample level: the minimum view is a few hundred samples, not seconds', () => {
  const view = zoomViewport({ start: 0, end: 48000 }, 0.5, 1e-6, 48000 * 60, AUDIO_EDIT_MIN_VIEW_FRAMES)
  expect(view.end - view.start).toBe(AUDIO_EDIT_MIN_VIEW_FRAMES)
  expect(AUDIO_EDIT_MIN_VIEW_FRAMES).toBeLessThanOrEqual(256)
})
