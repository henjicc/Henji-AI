import { afterEach, expect, it } from 'vitest'
import { clearTimelineSnap, readTimelineSnapIndicator, reportTimelineSnap, snapTimelineEdges, snapTimelineFrame, timelineSnapPoints } from './timelineSnap'

afterEach(() => clearTimelineSnap())

it('一起移动的边缘里最近的那个吸上，返回偏移并显示提示线；没吸上或吸附关闭时收起（4.4）', () => {
  expect(snapTimelineEdges('s', [0, 50, 100], [47, 97], 4)).toBe(3)
  expect(readTimelineSnapIndicator()).toEqual({ sequenceId: 's', frame: 50 })
  // 两缘都在范围内时取更近的那个
  expect(snapTimelineEdges('s', [0, 50, 100], [48, 101], 4)).toBe(-1)
  expect(readTimelineSnapIndicator()).toEqual({ sequenceId: 's', frame: 100 })
  // 正好落在吸附点上也显示提示线
  expect(snapTimelineFrame('s', [30], 30, 2)).toBe(30)
  expect(readTimelineSnapIndicator()).toEqual({ sequenceId: 's', frame: 30 })
  expect(snapTimelineFrame('s', [30], 40, 2)).toBe(40)
  expect(readTimelineSnapIndicator()).toBeNull()
  // 吸附关闭时传空吸附点：不吸也不显示
  snapTimelineFrame('s', [30], 31, 2); expect(snapTimelineFrame('s', [], 31, 2)).toBe(31)
  expect(readTimelineSnapIndicator()).toBeNull()
})
it('编辑领域自己吸附的拖动只报告结果；吸附点含播放头、编辑点、标记且可排除拖动中的片段（4.4）', () => {
  reportTimelineSnap('s', [10, 20], [5, 20]); expect(readTimelineSnapIndicator()).toEqual({ sequenceId: 's', frame: 20 })
  reportTimelineSnap('s', [10, 20], [5, 25]); expect(readTimelineSnapIndicator()).toBeNull()
  const sequence = { clips: [{ id: 'a', start: 10, duration: 20 }, { id: 'b', start: 40, duration: 5 }], markers: [{ id: 'm', frame: 70, name: '标记' }] } as Parameters<typeof timelineSnapPoints>[0]
  expect(timelineSnapPoints(sequence, { playhead: 33, excludeClipIds: new Set(['b']), extra: [90] }).sort((x, y) => x - y)).toEqual([0, 10, 30, 33, 70, 90])
})
