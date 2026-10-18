import { expect, it } from 'vitest'
import { videoEditPauseCutCandidates } from './pauseCuts'

it('只选择目标附近真实声音低谷，建议保留时长不越过低谷边界', () => {
  const pauses = [
    { startFrame: 20, endFrame: 30, kind: 'silence', cutFrame: 25 },
    { startFrame: 50, endFrame: 60, kind: 'punct', cutFrame: 55 },
    { startFrame: 90, endFrame: 94, kind: 'silence', cutFrame: 92 },
  ]
  expect(videoEditPauseCutCandidates(pauses, 30, { range: { from: 27, to: 90 }, retainedMs: 500 })).toEqual([
    { boundary: 'start', targetFrame: 27, cutFrame: 25, retainedFromFrame: 20, retainedToFrame: 30 },
    { boundary: 'end', targetFrame: 90, cutFrame: 92, retainedFromFrame: 90, retainedToFrame: 94 },
  ])
  expect(videoEditPauseCutCandidates(pauses, 30, { range: { from: 54, to: 57 } })).toEqual([])
  expect(videoEditPauseCutCandidates(pauses, 30, {})).toEqual([])
})

it('零保留时长与查无候选都有明确结果，不制造估算切点', () => {
  expect(videoEditPauseCutCandidates([{ startFrame: 10, endFrame: 20, kind: 'silence', cutFrame: 15 }], 30, { range: { from: 15, to: 40 }, retainedMs: 0 })).toEqual([
    { boundary: 'start', targetFrame: 15, cutFrame: 15, retainedFromFrame: 15, retainedToFrame: 15 },
  ])
})
