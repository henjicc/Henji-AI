import { afterAll, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cpus, totalmem } from 'node:os'
import { createMotionFixture, createLayoutFixture } from './fixtures/motionFixtures'
import { scoreMotionFixture } from './fixtures/scoring'
import { optimizeMotionDraft, motionCandidateIdentity } from './candidates'
import { createLayoutCandidates, solveStaticLayout } from './layout'

const metrics: { fixtures: ReturnType<typeof scoreMotionFixture>[]; short?: { motion: number[]; layout: number[] }; solver?: { eliminationMs: number; kiwiMs: number } } = { fixtures: [] }
afterAll(() => {
  if (process.env.HENJI_P1_BENCH_DIR) writeFileSync(join(process.env.HENJI_P1_BENCH_DIR, 'core.json'), JSON.stringify({ metadata: { cpu: cpus()[0].model, logicalCpus: cpus().length, memoryGiB: totalmem() / 1024 ** 3, node: process.versions.node, platform: process.platform }, ...metrics }, null, 2))
})

describe('motion-draft-benchmark-v1 synthetic P1', () => {
  it.each(['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S10', 'S11', 'S15', 'S16'])('%s preserves independent reference geometry and hard events', id => {
    const score = scoreMotionFixture(createMotionFixture(id))
    metrics.fixtures.push(score)
    expect(score.hardFailures, JSON.stringify(score)).toEqual([])
    expect(score.score).toBeGreaterThanOrEqual(85)
  })
  it.each([.25, .5, 1])('S10 slow acquisition at %sx never changes normal-speed action time', speed => {
    const f = createMotionFixture('S10', { speed }); const score = scoreMotionFixture(f)
    metrics.fixtures.push({ ...score, id: `S10@${speed}x` })
    expect(score.hardFailures, JSON.stringify(score)).toEqual([])
    expect(f.input.samples[f.input.samples.length - 1].monoUs).toBe(3000000 / speed)
    expect(score.eventOffsetFrames).toBeLessThanOrEqual(1)
  })
  it.each([{ numerator: 24000, denominator: 1001 }, { numerator: 60000, denominator: 1001 }])('rational fps %j preserves endpoint pins', fps => {
    const f = createMotionFixture('S01', { fps }); const score = scoreMotionFixture(f)
    metrics.fixtures.push({ ...score, id: `S01@${fps.numerator}/${fps.denominator}` })
    expect(score.hardFailures, JSON.stringify(score)).toEqual([])
  })
  it('S01 requested clean line reduces noisy RMS >=40%; faithful high-frequency input remains available', () => {
    const f = createMotionFixture('S01', { noisy: true }); const score = scoreMotionFixture(f)
    metrics.fixtures.push({ ...score, id: 'S01-noisy' })
    expect(score.hardFailures, JSON.stringify(score)).toEqual([])
    expect(score.rmsImprovement).toBeGreaterThanOrEqual(.4)
    expect(score.candidates).toBeGreaterThanOrEqual(2)
  })
  it('hard failures cannot be compensated by a high auxiliary score', () => {
    const f = createMotionFixture('S02'); const candidate = structuredClone(optimizeMotionDraft(f.input).candidates[0])
    candidate.motions[0].curves.x![0].value = .151
    const score = scoreMotionFixture(f, candidate)
    expect(score.hardFailures.some(f => f.startsWith('pin:'))).toBe(true)
  })
  it('short 10s/120Hz motion and 100-layer layout meet pure computation budgets after 5 warmups/30 measurements', () => {
    const motion = createMotionFixture('S01', { duration: 10, noisy: true }); const layout = createLayoutFixture(100); const identity = motionCandidateIdentity(motion.input.draft)
    const measurements: number[] = []; const layouts: number[] = []
    for (let i = 0; i < 35; i++) {
      let started = performance.now(); optimizeMotionDraft(motion.input); if (i >= 5) measurements.push(performance.now() - started)
      started = performance.now(); createLayoutCandidates(layout.items, layout.constraints, identity); if (i >= 5) layouts.push(performance.now() - started)
    }
    measurements.sort((a, b) => a - b); layouts.sort((a, b) => a - b)
    metrics.short = { motion: measurements, layout: layouts }
    expect(measurements[28]).toBeLessThanOrEqual(900); expect(layouts[28]).toBeLessThanOrEqual(900)
  }, 30000)
  it('same S13 sample: fixed-equality elimination and mature Cassowary produce matching geometry', () => {
    const layout = createLayoutFixture(); const identity = motionCandidateIdentity(createMotionFixture('S02').input.draft)
    let started = performance.now(); const direct = solveStaticLayout(layout.items, layout.constraints, identity); const eliminationMs = performance.now() - started
    started = performance.now(); const kiwi = solveStaticLayout(layout.items, layout.constraints, identity, {}, 'cassowary'); const kiwiMs = performance.now() - started
    metrics.solver = { eliminationMs, kiwiMs }
    direct.changes.forEach((c, i) => c.affine.forEach((v, j) => expect(v).toBeCloseTo(kiwi.changes[i].affine[j], 8)))
  })
})
