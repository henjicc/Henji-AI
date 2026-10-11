import { expect, it } from 'vitest'
import { createVideoEditMaskShape } from '../videoEdit/effectMasks'
import { evaluateVideoEditMaskPath } from '../videoEdit/maskPathAnimation'
import { compileMaskPathTake } from './maskPathAdapter'
import { videoEditClipSourceTimeAt, advanceVideoEditClipSource } from '../videoEdit/clipSpeed'
import { videoEditSourceSeconds } from '../videoEdit/time'

const clip = { start: 10, duration: 91, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }
const rate = { numerator: 30, denominator: 1 }
const picture = { width: 3840, height: 2160 }
const shape = createVideoEditMaskShape('ellipse', 'shape')
const pointIds = ['top', 'right', 'bottom', 'left']
const samples = Array.from({ length: 91 }, (_, i) => ({ frame: i + 10, hard: i === 30 || i === 60, value: { pointIds, points: shape.points.map(p => [p[0] + (i <= 30 ? i / 300 : i < 60 ? .1 : (90 - i) / 300), ...p.slice(1)] as typeof p) } }))

it('M03 closed path moves, dwells and returns with handles and hard events intact', () => {
  const pathAnimation = compileMaskPathTake(clip, rate, picture, samples)
  expect(pathAnimation.keys.length).toBeLessThanOrEqual(16)
  for (const s of samples) {
    const actual = evaluateVideoEditMaskPath({ ...shape, pathAnimation }, (s.frame - clip.start) / 30 * 1e6)
    actual.points.forEach((p, i) => p.forEach((v, c) => expect(Math.abs(v - s.value.points[i][c])).toBeLessThan(.00001)))
  }
  expect(pathAnimation.keys.some(k => k.sourceTimeUs === 1e6)).toBe(true)
  expect(pathAnimation.keys.some(k => k.sourceTimeUs === 2e6)).toBe(true)
})
it('M04 refuses point count/order/winding changes and empty/degenerate paths', () => {
  for (const value of [
    { pointIds: pointIds.slice(1), points: shape.points.slice(1) },
    { pointIds: [...pointIds].reverse(), points: [...shape.points].reverse() },
    { pointIds, points: [...shape.points].reverse().map(p => [p[0], p[1], p[4], p[5], p[2], p[3]] as typeof p) },
  ]) expect(() => compileMaskPathTake(clip, rate, picture, [samples[0], { frame: 20, value }])).toThrow()
  expect(() => compileMaskPathTake(clip, rate, picture, [])).toThrow()
  const withHoles = { ...samples[0], value: { ...samples[0].value, holes: [shape.points] } }
  expect(() => compileMaskPathTake(clip, rate, picture, [withHoles])).toThrow()
  const openPath = { ...samples[0], value: { ...samples[0].value, closed: false } }
  expect(() => compileMaskPathTake(clip, rate, picture, [openPath])).toThrow()
  expect(() => compileMaskPathTake(clip, rate, picture, samples, { cancelled: () => true })).toThrow()
})

it('path source time follows NTSC speed/reverse and remains unchanged after a trim', () => {
  const ntsc = { numerator: 30000, denominator: 1001 }
  const reverse = { ...clip, reverse: true, speed: { numerator: 2, denominator: 1 }, sourceInUs: 8e6 }
  const pathAnimation = compileMaskPathTake(reverse, ntsc, picture, samples)
  const trimmed = { ...reverse, ...advanceVideoEditClipSource(reverse, 20, ntsc), start: 30, duration: 71 }
  for (const s of samples.slice(20)) {
    const source = videoEditClipSourceTimeAt(reverse, s.frame - reverse.start, ntsc)
    expect(videoEditClipSourceTimeAt(trimmed, s.frame - trimmed.start, ntsc)).toEqual(source)
    const actual = evaluateVideoEditMaskPath({ ...shape, pathAnimation }, videoEditSourceSeconds(source) * 1e6)
    expect(Math.abs(actual.points[0][0] - s.value.points[0][0])).toBeLessThan(.00001)
  }
})
