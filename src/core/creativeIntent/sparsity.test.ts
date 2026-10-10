import { expect, it } from 'vitest'
import { createMotionFixture } from './fixtures/motionFixtures'
import { scoreMotionFixture } from './fixtures/scoring'
import { optimizeMotionDraft } from './candidates'
import { evaluateVideoEditKeyframes } from '../videoEdit/keyframes'

it('S15 meets the sparse reference without erasing its hold or reversing its second traversal', () => {
  const fixture = createMotionFixture('S15'); const before = JSON.stringify(fixture.input)
  const result = optimizeMotionDraft(fixture.input); const candidate = result.candidates[0]
  const score = scoreMotionFixture(fixture, candidate)
  expect(score.hardFailures, JSON.stringify(score)).toEqual([])
  expect(score.keyCount, JSON.stringify(score)).toBeLessThanOrEqual(24)
  expect(score.keyCount).toBeGreaterThanOrEqual(12)
  const curves = candidate.motions[0].curves
  for (let frame = 120; frame <= 150; frame += .25) {
    expect(evaluateVideoEditKeyframes(curves.x, frame, 0)).toBe(fixture.reference(2).position[0])
    expect(evaluateVideoEditKeyframes(curves.y, frame, 0)).toBe(fixture.reference(2).position[1])
  }
  expect(JSON.stringify(fixture.input)).toBe(before)
})
