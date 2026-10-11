import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLayoutCandidates, solveAdaptiveLayout, solveStaticLayout, type LayoutItem } from './layout'
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
  it.each(['x', 'y'] as const)('100 staggered objects keep their original rows/columns and positive equal edge gaps (%s)', axis => {
    const items: LayoutItem[] = Array.from({ length: 100 }, (_, i) => {
      const x = 30 + i % 10 * 72 + i % 3, y = 20 + Math.floor(i / 10) * 38 + i * 7 % 13
      const w = 10 + i % 4, h = 14 - i % 4 * 1.2
      const corners: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
      return { targetRef: { kind: 'image_edit.layer', id: String(i) }, affine: [1, 0, 0, 1, x, y], worldCorners: axis === 'x' ? corners : corners.map(([a, b]) => [b, a]), translationLocked: i === 24 }
    })
    const constraints = [{ kind: 'align' as const, id: 'edge', strength: 'soft' as const, sourceRefs: [], axis: axis === 'x' ? 'y' as const : 'x' as const, edge: 'start' as const, targets: items.map(i => i.targetRef), reference: items[0].targetRef }, { kind: 'distribute' as const, id: 'spacing', strength: 'soft' as const, sourceRefs: [], axis, targets: items.map(i => i.targetRef) }]
    const before = structuredClone(items)
    const result = createLayoutCandidates(items, constraints, identity).find(c => c.id === 'distribute')!
    const along = axis === 'x' ? 0 : 1, cross = axis === 'x' ? 1 : 0
    const tops: number[] = []
    for (let row = 0; row < 10; row++) {
      const members = items.slice(row * 10, row * 10 + 10)
      const top = members.map((item, j) => item.worldCorners[0][cross] + result.changes[row * 10 + j].delta[cross])
      top.forEach(value => expect(value).toBeCloseTo(top[0], 8)); tops.push(top[0])
      const gaps = members.slice(1).map((item, j) => item.worldCorners[0][along] + result.changes[row * 10 + j + 1].delta[along] - members[j].worldCorners[2][along] - result.changes[row * 10 + j].delta[along])
      gaps.forEach(gap => { expect(gap).toBeGreaterThan(0); expect(gap).toBeCloseTo(gaps[0], 8) })
    }
    expect(new Set(tops).size).toBe(10)
    tops.slice(1).forEach((top, i) => expect(top - tops[i]).toBeGreaterThanOrEqual(14))
    expect(result.changes[24].delta).toEqual([0, 0]); expect(items).toEqual(before)
  })
  it('automatic spacing keeps two-item rows without leaking synthetic anchors into changes', () => {
    const items: LayoutItem[] = Array.from({ length: 6 }, (_, i) => {
      const x = i % 2 * 15, y = Math.floor(i / 2) * 40
      return { targetRef: { kind: 'canvas.node', id: String(i) }, affine: [1, 0, 0, 1, x, y], worldCorners: [[x, y], [x + 20, y], [x + 20, y + 20]], translationLocked: i === 3 }
    })
    const result = solveAdaptiveLayout(items, [{ kind: 'align', id: 'edge', strength: 'hard', sourceRefs: [], axis: 'y', edge: 'start', targets: items.map(i => i.targetRef), reference: items[0].targetRef }, { kind: 'distribute', id: 'gap', strength: 'hard', sourceRefs: [], axis: 'x', targets: items.map(i => i.targetRef) }], identity)
    expect(result.changes).toHaveLength(6)
    for (let i = 0; i < 6; i += 2) expect(15 + result.changes[i + 1].delta[0] - result.changes[i].delta[0] - 20).toBeCloseTo(4, 8)
    expect(result.changes[3].delta).toEqual([0, 0])
  })
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
