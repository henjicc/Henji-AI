import { expect, it } from 'vitest'
import { VideoEditTimelineClock } from './timelineClock'
import { evaluateVideoEditKeyframes, mapVideoEditCurvesClock, sliceVideoEditCurves, videoEditKeyframesSchema, type VideoEditKeyframes } from './keyframes'

it('先抽出再插入时，分割位置与最终映射都追溯到同一原快照', () => {
  const clock = new VideoEditTimelineClock('sequence')
  expect(clock.maps).toEqual([])
  clock.splice(3, 7, 0)
  expect(clock.sourceFrame(3)).toBe(7)
  expect(clock.sourceFrame(5.5)).toBe(9.5)
  clock.splice(5, 5, 4)
  expect(clock.sourceFrame(4.75)).toBe(8.75)
  expect(clock.sourceFrame(5)).toBe(9)
  expect(clock.sourceFrame(8.75)).toBe(9)
  expect(clock.sourceFrame(9)).toBe(9)
  expect(clock.sourceFrame(10.25)).toBe(10.25)
  expect(clock.maps).toContainEqual({ sequenceId: 'sequence', sourceRange: [3, 7], targetRange: null })
  expect(clock.maps).toContainEqual({ sequenceId: 'sequence', sourceRange: [9, 9], targetRange: [5, 9] })
  clock.splice(6, 8, 0)
  expect(clock.sourceFrame(6.75)).toBe(9)
  expect(clock.sourceFrame(7)).toBe(9)
  expect(clock.sourceFrame(8.25)).toBe(10.25)
})

it('删除拼接、插入定格与再次删除保持切点两侧的线性、hold、ease 和 Bezier 子帧', () => {
  for (const interpolation of ['linear', 'hold', 'ease', 'bezier'] as const) {
    const points: VideoEditKeyframes = [{ time: 0, value: 0, interpolation, ...(interpolation === 'bezier' ? { bezier: [.2, 1.3, .8, -.2] as [number, number, number, number] } : {}) }, { time: 12, value: 1, interpolation: 'hold' }]
    const clock = new VideoEditTimelineClock('sequence')
    clock.splice(3, 7, 0)
    clock.splice(5, 5, 4)
    clock.splice(6, 8, 0)
    const mapped = mapVideoEditCurvesClock({ x: points }, clock.maps)!.x
    expect(videoEditKeyframesSchema.parse(mapped)).toEqual(mapped)
    for (let time = 0; time < 16; time += .125) {
      expect(evaluateVideoEditKeyframes(mapped, time, 0)).toBeCloseTo(evaluateVideoEditKeyframes(points, clock.sourceFrame(time), 0), 7)
    }
    const again = mapVideoEditCurvesClock({ x: mapped }, [{ sourceRange: [2, 5], targetRange: null }, { sourceRange: [5, 16], targetRange: [2, 13] }])!.x
    const sliced = sliceVideoEditCurves({ x: again }, 1, 10, undefined, 'continuous')!.x
    expect(videoEditKeyframesSchema.parse(sliced)).toEqual(sliced)
    for (let time = 0; time < 10; time += .125) {
      const previous = time + 1 < 2 ? time + 1 : time + 4
      expect(evaluateVideoEditKeyframes(sliced, time, 0)).toBeCloseTo(evaluateVideoEditKeyframes(mapped, previous, 0), 7)
    }
  }
})
