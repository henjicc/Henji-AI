import { expect, it } from 'vitest'
import { filterVideoEditAnnotations } from './annotationQuery'
import type { VideoEditAnnotation } from './annotations'

const mark = (id: string, patch: Partial<VideoEditAnnotation>): VideoEditAnnotation => ({ id, frame: 0, space: 'composition-normalized', target: { kind: 'point', x: .5, y: .5 }, text: id, status: 'open', author: { kind: 'user', name: '我' }, createdAt: '2026-10-28T00:00:00.000Z', thread: [], ...patch })

it('时间段按闭区间重叠命中，片段同时认所属片段与时间段目标里的片段，各条件取交集', () => {
  const marks = [
    mark('before', { frame: 0, endFrame: 9 }),
    mark('touch-start', { frame: 5, endFrame: 10, clipId: 'a' }),
    mark('inside', { frame: 15, status: 'addressed', author: { kind: 'assistant', name: '助手' } }),
    mark('range-target', { frame: 18, endFrame: 40, target: { kind: 'range', startFrame: 18, endFrame: 40, clipIds: ['a', 'b'] } }),
    mark('after', { frame: 21, clipId: 'b' }),
  ]
  const ids = (filter: Parameters<typeof filterVideoEditAnnotations>[1]) => filterVideoEditAnnotations(marks, filter).map(item => item.id)
  expect(ids({ range: { fromFrame: 10, toFrame: 20 } })).toEqual(['touch-start', 'inside', 'range-target'])
  expect(ids({ clipIds: ['a'] })).toEqual(['touch-start', 'range-target'])
  expect(ids({ clipIds: ['b'], range: { fromFrame: 0, toFrame: 20 } })).toEqual(['range-target'])
  expect(ids({ statuses: ['addressed'], authorKinds: ['assistant'] })).toEqual(['inside'])
  expect(ids({ authorKinds: ['external'] })).toEqual([])
  expect(ids({})).toHaveLength(marks.length)
})
