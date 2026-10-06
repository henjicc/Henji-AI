import { expect, it } from 'vitest'
import { clampVideoEditTrackHeight, videoEditAdjacentPoint, videoEditClipsAtFrame, videoEditEditPoints, videoEditSnapFrame, videoEditZoomToFit } from './timelineNavigation'

const clips = [{ track: 1, start: 10, duration: 20 }, { track: 2, start: 25, duration: 10 }, { track: 1, start: 30, duration: 5 }]
it('编辑点按目标轨道收集、去重升序，相邻点严格早于或晚于当前帧', () => {
  expect(videoEditEditPoints({ clips: clips as never })).toEqual([10, 25, 30, 35])
  expect(videoEditEditPoints({ clips: clips as never }, [1])).toEqual([10, 30, 35])
  expect(videoEditAdjacentPoint([10, 30, 35], 30, -1)).toBe(10)
  expect(videoEditAdjacentPoint([10, 30, 35], 30, 1)).toBe(35)
  expect(videoEditAdjacentPoint([10, 30, 35], 5, -1)).toBeUndefined()
  expect(videoEditClipsAtFrame(clips, 30, [1])).toEqual([clips[2]])
})
it('吸附只在阈值内取最近点；缩放到序列与轨道高度夹在合法范围', () => {
  expect(videoEditSnapFrame([10, 30], 27, 4)).toBe(30)
  expect(videoEditSnapFrame([10, 30], 20, 4)).toBe(20)
  expect(videoEditZoomToFit(300, 30, 600)).toBe(1)
  expect(videoEditZoomToFit(30 * 1800, 30, 600)).toBe(0.1)
  expect(clampVideoEditTrackHeight(500)).toBe(160); expect(clampVideoEditTrackHeight(3)).toBe(24)
})
