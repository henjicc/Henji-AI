import { expect, it } from 'vitest'
import { reviewMotionSamples, type MotionReviewSample } from './motionReview'
import { validateVideoMotionScan } from './motionEvidence'

const sample = (index: number, speed: number | null, extra: Partial<MotionReviewSample> = {}): MotionReviewSample => ({ fromSeconds: index / 20, toSeconds: (index + 1) / 20, speed, zoom: 0, change: 0, cut: false, still: speed === 0, ...extra })

it('finds a sustained move and hard stop, but never infers a stop at a cut, unknown interval or query boundary', () => {
  const moving = Array.from({ length: 12 }, (_, i) => sample(i, 20))
  const stopped = Array.from({ length: 4 }, (_, i) => sample(i + 12, 0))
  expect(reviewMotionSamples([...moving, ...stopped]).events).toMatchObject([{ kind: 'move', hardStop: true, peak: 20 }])
  for (const tail of [[], [sample(12, null)], [sample(12, 0, { cut: true })]]) {
    expect(reviewMotionSamples([...moving, ...tail]).events.some(event => event.hardStop)).toBe(false)
  }
})

it('keeps gentle carrying motion out of event counts and keeps reading holds as evidence without judging them', () => {
  const slow = Array.from({ length: 40 }, (_, i) => sample(i, .8, { still: false, zoom: 1.2 }))
  expect(reviewMotionSamples(slow)).toMatchObject({ events: [], stillness: [], summary: { eventCount: 0, stillSeconds: 0 } })
  const hold = Array.from({ length: 60 }, (_, i) => sample(i, 0))
  const report = reviewMotionSamples(hold)
  expect(report.stillness).toEqual([{ fromSeconds: 0, toSeconds: 3 }])
  expect(report.events).toEqual([])
  expect(report).not.toHaveProperty('failed')
})

it('merges nearby local changes, counts independent events and obeys an explicit style interval', () => {
  const values = Array.from({ length: 60 }, (_, i) => sample(i, 0, { change: [2, 6, 35].includes(i) ? .1 : 0 }))
  const report = reviewMotionSamples(values, { minGapSeconds: 2 })
  expect(report.events.map(event => [event.kind, event.fromSeconds, event.toSeconds])).toEqual([['change', .1, .35], ['change', 1.75, 1.8]])
  expect(report.crowded).toHaveLength(1)
  expect(reviewMotionSamples(values, { minGapSeconds: .8 }).crowded).toEqual([])
})

it('preserves unknown samples and unsampled gaps instead of carrying motion or stillness across them', () => {
  const report = reviewMotionSamples([sample(0, 20), sample(1, null), sample(2, 0), sample(23, 0)], { minimumStillSeconds: 0 })
  expect(report.unknown).toEqual([{ fromSeconds: .05, toSeconds: .1 }, { fromSeconds: .15, toSeconds: 1.15 }])
  expect(report.stillness).toEqual([{ fromSeconds: .1, toSeconds: .15 }, { fromSeconds: 1.15, toSeconds: 1.2 }])
  expect(report.summary.unknownSeconds).toBeCloseTo(1.05)
  expect(report.events).toEqual([])
})

it('bounds the returned curve while retaining all evidence and rejects malformed or incomplete grids', () => {
  const values = Array.from({ length: 4500 }, (_, i) => sample(i, 0))
  expect(reviewMotionSamples(values).curve.length).toBeLessThanOrEqual(400)
  expect(reviewMotionSamples(values).summary.stillSeconds).toBe(225)
  expect(() => reviewMotionSamples([sample(0, Number.NaN)])).toThrow()
  expect(() => reviewMotionSamples([sample(1, 0), sample(0, 0)])).toThrow('逆序')
  expect(() => reviewMotionSamples([sample(0, 0)], { minGapSeconds: -1 })).toThrow('间隔')
  const scan = { startSeconds: 0, endSeconds: .1, samplingFps: 20, width: 320, height: 180, sampledFrames: 2, samples: [sample(0, 0), sample(1, 0)] }
  expect(validateVideoMotionScan(scan, 0, .1)).toEqual(scan)
  expect(() => validateVideoMotionScan({ ...scan, samples: scan.samples.slice(0, 1) }, 0, .1)).toThrow('完整覆盖')
  expect(() => validateVideoMotionScan({ ...scan, samples: [sample(1, 0), sample(2, 0)] }, 0, .1)).toThrow('采样时钟')
})
