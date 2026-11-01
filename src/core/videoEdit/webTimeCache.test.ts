import { expect, it } from 'vitest'
import { offsetVideoEditSource } from './time'
import { webTimeAtFrame, webTimeFrameAt, webTimeGrid, webTimeSegment } from './webTimeCache'
import { codeMediaInputSample, codeMediaWebTimeGrid } from './codeMediaInput'

it('任意入点与 NTSC 剪点共用精确相位，预览向前取邻帧，精确请求不吞掉子帧', () => {
  const rate = { numerator: 60000, denominator: 1001 }
  const origin = { sourceInUs: 1234567, sourceRemainder: { numerator: 1, denominator: 3 } }
  const grid = webTimeGrid(rate, origin)
  expect(webTimeGrid({ numerator: 120000, denominator: 2002 }, origin)).toEqual(grid)
  expect(webTimeGrid(rate, offsetVideoEditSource(origin, 720000, rate))).toEqual(grid)
  for (const frame of [0, 1, 119, 120, 720000, 5000000]) {
    const time = webTimeAtFrame(grid, frame)
    expect(webTimeFrameAt(grid, time)).toBe(frame)
    expect(webTimeFrameAt(grid, time + .001)).toBeUndefined()
    expect(webTimeFrameAt(grid, time + .001, 'previous')).toBe(frame)
    expect(webTimeFrameAt(grid, time - .001, 'previous')).toBe(frame ? frame - 1 : undefined)
  }
  expect(webTimeGrid(rate, { ...origin, sourceInUs: origin.sourceInUs + 1 })).not.toEqual(grid)
})

it('正式网页时间表按精确分数传递相位，长NTSC片段和分数倍率不逐帧制造尾差键', () => {
  const rate = { numerator: 60000, denominator: 1001 }
  const clip = { start: 121, sourceInUs: 1234567, sourceRemainder: { numerator: 1, denominator: 3 } }
  const reference = { kind: 'web' as const, path: '/fixture', spans: [{ from: 0, to: 100000, src: 0.12345, rate: 0.5 }] }
  const even = new Set<string>(), odd = new Set<string>()
  for (let frame = 121; frame < 1121; frame++) {
    const grid = codeMediaWebTimeGrid(clip, reference, frame, rate)!
    ;(frame % 2 ? odd : even).add(JSON.stringify(grid))
    expect(webTimeFrameAt(grid, codeMediaInputSample(clip, reference, frame, rate)!.seconds)).toBeDefined()
  }
  expect(even.size).toBe(1); expect(odd.size).toBe(1)
  expect([...even][0]).not.toBe([...odd][0])
  expect(codeMediaWebTimeGrid(clip, { ...reference, time: 0.123 }, 1, rate)).toEqual(codeMediaWebTimeGrid(clip, { ...reference, time: 0.123 }, 1_000_000, rate))
})

it('段以绝对帧号切分，末段不包含 duration 端点，未知时长只返回当前需求', () => {
  const grid = webTimeGrid({ numerator: 60000, denominator: 1001 }, { sourceInUs: 1234567, sourceRemainder: { numerator: 0, denominator: 1 } })
  const end = webTimeAtFrame(grid, 123)
  expect(webTimeSegment(grid, 0, end)).toEqual({ index: 0, firstFrame: 0, frameCount: 120 })
  expect(webTimeSegment(grid, 1, end)).toEqual({ index: 1, firstFrame: 120, frameCount: 3 })
  expect(webTimeSegment(grid, 2, end)).toBeUndefined()
  expect(webTimeSegment(grid, 7, null)).toEqual({ index: 7, firstFrame: 840, frameCount: 120 })
  expect(webTimeSegment(grid, 0, 0)).toBeUndefined()
})
