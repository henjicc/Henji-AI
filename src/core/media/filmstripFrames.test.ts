import { describe, expect, it } from 'vitest'
import { FILMSTRIP_GRID_US, filmstripGridStepUs, filmstripHeightBucket, filmstripTileWidth, isFilmstripHeight, planFilmstripTiles, type FilmstripPlanInput } from './filmstripFrames'
import { videoEditClipSourceSecondsAt, type VideoEditClipTiming } from '../videoEdit/clipSpeed'

const base: FilmstripPlanInput = { clipWidth: 1000, tileWidth: 100, visibleFrom: 0, visibleTo: 1000, sourceInSeconds: 2, secondsPerPixel: 0.01, mediaEndSeconds: 60, frameSeconds: 1 / 30 }

describe('filmstrip frame planning', () => {
  it.each([false, true])('accepts a clip-speed source mapping and bounds quantized frames in playback direction (reverse=%s)', reverse => {
    const clip: VideoEditClipTiming = { start: 30, duration: 300, sourceInUs: 20_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, speed: { numerator: 2, denominator: 1 }, reverse }
    const mapped = (pixel: number): number => videoEditClipSourceSecondsAt(clip, clip.start + Math.min(clip.duration - 1, Math.floor(pixel / 10)), 30)
    const input = { ...base, clipWidth: 3000, tileWidth: 150, visibleTo: 3000, sourceSecondsAtPixel: mapped }
    const tiles = planFilmstripTiles(input)
    expect(tiles[0].timeUs).toBe(Math.floor(mapped(0) * 1e6))
    expect(tiles[1].timeUs).toBe(reverse ? 18_000_000 : 21_000_000)
    for (let index = 1; index < tiles.length; index++) {
      expect(tiles[index].timeUs).toBeGreaterThanOrEqual(reverse ? 0 : 20_000_000)
      expect(tiles[index].timeUs).toBeLessThan(reverse ? 20_000_000 : 40_000_000)
      if (reverse) expect(tiles[index].timeUs).toBeLessThanOrEqual(tiles[index - 1].timeUs)
      else expect(tiles[index].timeUs).toBeGreaterThanOrEqual(tiles[index - 1].timeUs)
    }
    const scrolled = planFilmstripTiles({ ...input, visibleFrom: 1500, visibleTo: 2000 })
    expect(scrolled).toEqual(tiles.filter(tile => tile.index >= 9 && tile.index <= 14))
  })

  it('keeps the last mapped tile inside the used source range even below the cache grid resolution', () => {
    const clip: VideoEditClipTiming = { start: 0, duration: 2, sourceInUs: 35_000, sourceRemainder: { numerator: 0, denominator: 1 }, speed: { numerator: 1, denominator: 2 }, reverse: true }
    const mapped = (pixel: number): number => videoEditClipSourceSecondsAt(clip, Math.min(1, Math.floor(pixel / 100)), 30)
    const tiles = planFilmstripTiles({ ...base, clipWidth: 200, visibleTo: 200, sourceSecondsAtPixel: mapped })
    expect(tiles.map(tile => tile.timeUs)).toEqual([18_333, 1_666])
    expect(planFilmstripTiles({ ...base, clipWidth: 200, visibleTo: 200, mediaEndSeconds: 0.01, sourceSecondsAtPixel: mapped }).every(tile => tile.timeUs === 0)).toBe(true)
  })
  it('buckets device heights and sizes tiles by the picture aspect', () => {
    expect([1, 32, 33, 56, 300].map(filmstripHeightBucket)).toEqual([32, 32, 48, 64, 256])
    expect(isFilmstripHeight(48)).toBe(true); expect(isFilmstripHeight(50)).toBe(false); expect(isFilmstripHeight('48')).toBe(false)
    expect(filmstripTileWidth(27, 16 / 9)).toBe(48)
    expect(filmstripTileWidth(27, 0)).toBe(48)
    expect(filmstripTileWidth(27, 9 / 16)).toBe(15)
    expect(filmstripTileWidth(20, 10)).toBe(80)
  })

  it('quantizes tile times onto a power-of-two grid no coarser than one tile, so zoom levels share frames', () => {
    expect(filmstripGridStepUs(1)).toBe(FILMSTRIP_GRID_US)
    expect(filmstripGridStepUs(999_999)).toBe(500_000)
    expect(filmstripGridStepUs(1_000_000)).toBe(1_000_000)
    const coarse = planFilmstripTiles({ ...base, secondsPerPixel: 0.02 })
    const fine = planFilmstripTiles({ ...base, secondsPerPixel: 0.01, clipWidth: 2000, visibleTo: 2000 })
    // The first tile is always the in point itself.
    expect(coarse[0]).toEqual({ index: 0, left: 0, width: 100, timeUs: 2_000_000 })
    // Every coarse frame after the first is also a frame of the next finer zoom level.
    const fineTimes = new Set(fine.map(tile => tile.timeUs))
    expect(coarse.slice(1).every(tile => fineTimes.has(tile.timeUs))).toBe(true)
    // Times never go backwards and never precede the in point.
    for (const plan of [coarse, fine]) for (let index = 1; index < plan.length; index++) expect(plan[index].timeUs).toBeGreaterThanOrEqual(plan[index - 1].timeUs)
    // Each tile shows a frame from within its own span.
    for (const tile of fine) expect(tile.timeUs).toBeLessThanOrEqual(2_000_000 + tile.left * 10_000)
    expect(fine.slice(1).every(tile => tile.timeUs > 2_000_000 + (tile.left - 100) * 10_000)).toBe(true)
  })

  it('lays out only the visible span plus one tile each side, clips the last tile and stays inside the media', () => {
    const visible = planFilmstripTiles({ ...base, visibleFrom: 450, visibleTo: 650 })
    expect(visible.map(tile => tile.index)).toEqual([3, 4, 5, 6, 7])
    const tail = planFilmstripTiles({ ...base, clipWidth: 250, visibleTo: 250 })
    expect(tail.map(tile => tile.width)).toEqual([100, 100, 50])
    const end = planFilmstripTiles({ ...base, sourceInSeconds: 59.9, mediaEndSeconds: 60 })
    const lastUs = Math.floor((60 - 1 / 30) * 1_000_000)
    expect(end.every(tile => tile.timeUs <= lastUs)).toBe(true)
    // The first tile floors to whole microseconds so it never lands after the in-point picture.
    expect(planFilmstripTiles({ ...base, sourceInSeconds: 1 / 3 })[0].timeUs).toBe(333_333)
    expect(planFilmstripTiles({ ...base, visibleFrom: 2000, visibleTo: 2100 })).toEqual([])
    expect(planFilmstripTiles({ ...base, clipWidth: 0 })).toEqual([])
  })
})
