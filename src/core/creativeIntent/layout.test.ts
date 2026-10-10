import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLayoutCandidates, solveStaticLayout } from './layout'
import { motionCandidateIdentity } from './candidates'
import { createLayoutFixture, createMotionFixture } from './fixtures/motionFixtures'
import { translateAffine } from '../imaging/transforms'

const identity = motionCandidateIdentity(createMotionFixture('S02').input.draft)
const boundaryMetrics: { name: string; elapsedMs: number; failed: boolean }[] = []
let caseStart = 0
beforeEach(() => { caseStart = performance.now() })
afterEach(context => { boundaryMetrics.push({ name: context.task.name, elapsedMs: performance.now() - caseStart, failed: context.task.result?.state === 'fail' }) })
afterAll(() => { if (process.env.HENJI_P1_BENCH_DIR) writeFileSync(join(process.env.HENJI_P1_BENCH_DIR, 'layout-boundaries.json'), JSON.stringify(boundaryMetrics, null, 2)) })
describe('real-edge static layout', () => {
  it('S13: top edges and edge gaps are exact; pinned main image and title never move', () => {
    const f = createLayoutFixture(); const before = JSON.stringify(f)
    const candidates = createLayoutCandidates(f.items, f.constraints, identity); expect(candidates).toHaveLength(2)
    const changes = candidates[1].changes
    expect(changes[0].affine).toEqual(f.items[0].affine); expect(changes[3].affine).toEqual(f.items[3].affine)
    const top = f.items.slice(0, 3).map((item, i) => item.worldCorners[0][1] + changes[i].delta[1]); expect(top[1]).toBeCloseTo(top[0], 10); expect(top[2]).toBeCloseTo(top[0], 10)
    for (const i of [1, 2]) expect(f.items[i].worldCorners[0][0] + changes[i].delta[0] - f.items[i - 1].worldCorners[1][0] - changes[i - 1].delta[0]).toBeCloseTo(.06, 10)
    expect(JSON.stringify(f)).toBe(before)
  })
  it('hard conflicts reject with references rather than moving a pinned object', () => {
    const f = createLayoutFixture(); f.items[1].translationLocked = true
    expect(() => solveStaticLayout(f.items, f.constraints, identity)).toThrow('硬对齐')
    f.items[1].translationLocked = false; expect(solveStaticLayout(f.items, f.constraints, identity).maxConstraintError).toBeLessThan(1e-8)
  })
  it('fixed nonuniform/rotated affines remain complete; shared groups preserve relative translations', () => {
    const f = createLayoutFixture(); f.items[1].affine = [2, .4, -.3, .8, .46, .63]
    const result = solveStaticLayout(f.items, f.constraints, identity); expect(result.changes[1].affine.slice(0, 4)).toEqual(f.items[1].affine.slice(0, 4))
    expect(result.changes[1].affine).toEqual(translateAffine(f.items[1].affine, result.changes[1].delta))
    f.items[1].groupRef = { kind: 'image_edit.layer', id: 'group0' }; f.items[2].groupRef = f.items[1].groupRef
    const grouped = solveStaticLayout(f.items, [], identity); expect(grouped.changes[1].delta).toEqual(grouped.changes[2].delta)
    f.items[1].affine = [0, 0, 0, 0, 0, 0]; expect(() => solveStaticLayout(f.items, [], identity)).toThrow('几何无解')
  })
  it('S18: 1000 items include a pinned tail; no target cap or order truncation', () => {
    const f = createLayoutFixture(1000); f.items[999].translationLocked = true
    const result = solveStaticLayout(f.items, f.constraints, identity)
    expect(result.changes).toHaveLength(1000); expect(result.changes[999].affine).toEqual(f.items[999].affine); expect(result.maxConstraintError).toBeLessThan(1e-8)
  }, 15000)
})
