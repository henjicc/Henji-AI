import { expect, it } from 'vitest'
import { TIMELINE_ZOOM_BAR_MIN_THUMB, timelineZoomBarCenterAt, timelineZoomBarDrag, timelineZoomBarThumb } from './timelineZoomBar'
import { timelineTrimEdge, timelineTrimRequest } from './timelineTrimGesture'

const state = { totalFrames: 1000, startFrame: 200, visibleFrames: 100 }

it('滑块按可见范围占总范围的比例画出，太短时保留能抓住两端的最小宽度', () => {
  expect(timelineZoomBarThumb(state, 500)).toEqual({ left: 100, width: 50 })
  expect(timelineZoomBarThumb({ ...state, visibleFrames: 1 }, 500).width).toBe(TIMELINE_ZOOM_BAR_MIN_THUMB)
  // 全部看得见时滑块铺满
  expect(timelineZoomBarThumb({ totalFrames: 50, startFrame: 0, visibleFrames: 80 }, 500)).toEqual({ left: 0, width: 500 })
})
it('拖中间只平移且不越界；拖两端固定另一端改可见范围', () => {
  expect(timelineZoomBarDrag(state, 'move', 50, 500)).toEqual({ from: 300, to: 400 })
  expect(timelineZoomBarDrag(state, 'move', 5000, 500)).toEqual({ from: 900, to: 1000 })
  expect(timelineZoomBarDrag(state, 'start', -100, 500)).toEqual({ from: 0, to: 300 })
  expect(timelineZoomBarDrag(state, 'start', 1000, 500)).toEqual({ from: 299, to: 300 })
  expect(timelineZoomBarDrag(state, 'end', 50, 500)).toEqual({ from: 200, to: 400 })
  expect(timelineZoomBarDrag(state, 'end', 5000, 500)).toEqual({ from: 200, to: 1000 })
  expect(timelineZoomBarCenterAt(state, 250, 500)).toBe(450)
})
it('修剪工具：靠近片段一端才抓住编辑点，外滑向右拖露出更早的内容', () => {
  const clip = { start: 100, duration: 50 }
  expect(timelineTrimEdge(clip, 102, 2)).toBe('in')
  expect(timelineTrimEdge(clip, 147, 2)).toBe('out')
  expect(timelineTrimEdge(clip, 125, 2)).toBeUndefined()
  expect(timelineTrimEdge(clip, 125, 2, 'out')).toBe('out')
  expect(timelineTrimRequest('slip', undefined, clip, 10)).toEqual({ delta: -10, edges: [] })
  expect(timelineTrimRequest('slide', undefined, clip, 10)).toEqual({ delta: 10, edges: [110, 160] })
  expect(timelineTrimRequest('ripple', 'in', clip, -5)).toEqual({ delta: -5, edges: [95] })
})
