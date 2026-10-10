import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluateVideoEditKeyframes } from '../videoEdit/keyframes'
import { optimizeMotionDraft, assertCandidateCurrent, motionCandidateIdentity, optimizeMotionBatches } from './candidates'
import { createMotionFixture, fixtureMapping } from './fixtures/motionFixtures'
import { checkCancelled, CreativeIntentError, prepareMotionTakes, unwrapRotationTurns } from './sampling'
import { fitScalarCurve, scalarCurveExtremaTimes } from './fitting'
import { motionIntentSchema } from './recipe'

const boundaryMetrics: { name: string; elapsedMs: number; failed: boolean }[] = []
let caseStart = 0
beforeEach(() => { caseStart = performance.now() })
afterEach(context => { boundaryMetrics.push({ name: context.task.name, elapsedMs: performance.now() - caseStart, failed: context.task.result?.state === 'fail' }) })
afterAll(() => { if (process.env.HENJI_P1_BENCH_DIR) writeFileSync(join(process.env.HENJI_P1_BENCH_DIR, 'motion-boundaries.json'), JSON.stringify(boundaryMetrics, null, 2)) })

describe('P1 motion compiler boundaries', () => {
  it('pins are exact before and after formal curve quantization; raw draft bytes never change', () => {
    const f = createMotionFixture('S02'); const before = JSON.stringify(f.input)
    const result = optimizeMotionDraft(f.input); expect(result.candidates.length).toBeGreaterThan(0)
    for (const candidate of result.candidates) for (const pin of f.input.draft.pins) {
      const s = f.input.samples.find(s => s.sampleId === pin.sampleId)!
      expect(evaluateVideoEditKeyframes(candidate.motions[0].curves.x, s.timeline!.frame, -99)).toBe(s.pose.position[0])
    }
    expect(JSON.stringify(f.input)).toBe(before)
  })
  it('S14: mutually exclusive same-frame pins report both pin IDs; corrected time recovers', () => {
    const f = createMotionFixture('S01'); const at = f.input.samples.findIndex(s => s.timeline!.frame === 60)
    f.input.samples[at].pose.position[0] = .3; f.input.samples[at + 1].pose.position[0] = .4
    f.input.draft.pins.push(...[at, at + 1].map((i, j) => ({ id: `conflict:${j}`, sampleId: f.input.samples[i].sampleId, targetRef: f.input.draft.targets[0].ref, properties: ['position' as const], timeLocked: true, valueLocked: true })))
    try { optimizeMotionDraft(f.input); expect.fail('conflicting pins accepted') } catch (e) { expect(e).toBeInstanceOf(CreativeIntentError); expect((e as CreativeIntentError).refs).toEqual(['conflict:0', 'conflict:1']) }
    f.input.samples[at + 1].timeline!.frame = 61; f.input.samples[at + 2].timeline!.frame = 61
    expect(optimizeMotionDraft(f.input).candidates.length).toBeGreaterThan(0)
  })
  it('ordinary repeated frames use last confirmed pose, while a pinned earlier pose remains binding', () => {
    const f = createMotionFixture('S01'); f.input.intent = undefined
    f.input.samples[0].pose.position[0] = .12; f.input.samples[1].pose.position[0] = .18
    const take = prepareMotionTakes(f.input.draft, f.input.samples)[0]
    expect(take.points[0].pose.position[0]).toBe(.12)
    f.input.draft.pins.shift(); expect(prepareMotionTakes(f.input.draft, f.input.samples)[0].points[0].pose.position[0]).toBe(.18)
  })
  it('E02: navigate and pure hover do not invent an element action or bounce', () => {
    const f = createMotionFixture('S02'); f.input.draft.takes[0].intent = 'navigate'; f.input.draft.pins = []
    expect(optimizeMotionDraft(f.input).candidates).toHaveLength(0)
    const two = createMotionFixture('S01'); two.input.samples = [two.input.samples[0], two.input.samples[two.input.samples.length - 1]]; two.input.intent = undefined
    const curves = optimizeMotionDraft(two.input).candidates[0].motions[0].curves.x!
    expect(evaluateVideoEditKeyframes(curves, 60, -99)).toBeCloseTo(.45)
  })
  it('E04: backwards demonstration sorts only its take; cross-take revisits require selection', () => {
    const f = createMotionFixture('S01'); f.input.intent = undefined
    const end = f.input.samples[f.input.samples.length - 1].timeline!.frame
    f.input.samples.forEach(s => { s.timeline!.frame = end - s.timeline!.frame })
    f.input.draft.takes[0].direction = -1; f.input.draft.takes[0].timelineRange = [end, 0]
    const result = optimizeMotionDraft(f.input)
    expect(evaluateVideoEditKeyframes(result.candidates[0].motions[0].curves.x, 0, -99)).toBe(.75)
    expect(evaluateVideoEditKeyframes(result.candidates[0].motions[0].curves.x, 120, -99)).toBe(.15)
    const extra = structuredClone(f.input.samples[0]); extra.seq = f.input.samples.length; extra.monoUs = f.input.samples[f.input.samples.length - 1].monoUs + 1; extra.sampleId = 'revisit'; extra.takeRef = 'take1'; extra.timeline!.visitRef = 'v1'
    extra.clockSegmentRef = 'c1'; f.input.draft.clockSegments.push({ id: 'c1', mode: 'hold', monoSpanUs: [extra.monoUs, extra.monoUs + 1], start: extra.timeline, end: extra.timeline, anchors: [] })
    f.input.samples = [...f.input.samples, extra]; f.input.draft.takes.push({ ...f.input.draft.takes[0], id: 'take1', direction: 0, visitRef: 'v1', monoSpanUs: [extra.monoUs, extra.monoUs], timelineRange: [extra.timeline!.frame, extra.timeline!.frame] })
    expect(() => optimizeMotionDraft(f.input)).toThrow('重访')
    expect(optimizeMotionDraft({ ...f.input, selectedTakeIds: ['take0'] }).candidates.length).toBeGreaterThan(0)
  })
  it('zero timeline span does not turn wall-clock waiting into a dwell animation', () => {
    const f = createMotionFixture('S01'); f.input.samples.forEach(s => { s.timeline!.frame = 0 }); f.input.draft.takes[0].direction = 0; f.input.draft.takes[0].timelineRange = [0, 0]; f.input.draft.pins = []
    const result = optimizeMotionDraft(f.input)
    expect(result.candidates[0].motions[0].keyCount).toBe(1); expect(result.unavailable.some(u => u.code === 'zero-duration')).toBe(true)
  })
  it('dense legitimate jitter stays representable; equal endpoints retain interior motion', () => {
    const f = createMotionFixture('S16'); f.input.draft.fidelity = 1
    const candidate = optimizeMotionDraft(f.input).candidates[0]
    expect(candidate.motions[0].keyCount).toBeGreaterThan(20)
    const take = prepareMotionTakes(f.input.draft, f.input.samples)[0]
    for (const point of take.points) expect(evaluateVideoEditKeyframes(candidate.motions[0].curves.x, point.frame, -99)).toBe(point.pose.position[0])
    expect(evaluateVideoEditKeyframes(candidate.motions[0].curves.x, 2, .5)).not.toBe(.5)
    const fitted = fitScalarCurve([{ time: 0, value: 0, hard: true }, { time: 10, value: 1, hard: true }, { time: 20, value: 0, hard: true }], .0005)
    expect(evaluateVideoEditKeyframes(fitted.points, 10, -99)).toBe(1)
  })
  it('explicit spring retains oscillation including zero damping; semantic variants differ under native evaluation', () => {
    const f = createMotionFixture('S03'); f.input.intent = { kind: 'spring_settle', from: [.15, .5], to: [.75, .5], damping: 0, cycles: 1 }
    const spring = optimizeMotionDraft(f.input).candidates.find(c => c.id === 'intent')
    expect(spring).toBeDefined(); expect(evaluateVideoEditKeyframes(spring!.motions[0].curves.x, 24, 0)).toBeGreaterThan(.8)
    const over = optimizeMotionDraft(createMotionFixture('S03').input); expect(over.candidates).toHaveLength(2)
    const focus = optimizeMotionDraft(createMotionFixture('S08').input); expect(focus.candidates).toHaveLength(2)
    expect(focus.unavailable.some(u => u.code === 'no-distinct-result')).toBe(true)
  })
  it('S17: missing actual presentation, wrong direction, invalid references and expired inputs block use', () => {
    const f = createMotionFixture('S02'); const candidate = optimizeMotionDraft(f.input).candidates[0]
    expect(() => assertCandidateCurrent(candidate, motionCandidateIdentity(f.input.draft, f.input))).not.toThrow()
    const changedFidelity = { ...f.input.draft, fidelity: 1 }
    expect(() => assertCandidateCurrent(candidate, motionCandidateIdentity(changedFidelity, f.input))).toThrow('重新预览')
    const identity = motionCandidateIdentity(f.input.draft, f.input); identity.targetBases[0].baseDigest = `sha256:${'c'.repeat(64)}`
    expect(() => assertCandidateCurrent(candidate, identity)).toThrow('重新预览')
    f.input.samples[3].quality = 'estimated'; expect(() => optimizeMotionDraft(f.input)).toThrow('实际呈现')
    f.input.samples[3].quality = 'presented'; f.input.samples[3].targetRef = { ...f.input.samples[3].targetRef, id: 'deleted' }; expect(() => optimizeMotionDraft(f.input)).toThrow('引用无效')
  })
  it('S17: a declared acquisition gap cannot be interpolated, and navigate cannot bypass foreign clock refs', () => {
    const f = createMotionFixture('S02'); const start = structuredClone(f.input.draft.clockSegments[0])
    start.monoSpanUs = [0, 900000]
    f.input.draft.clockSegments = [start, { id: 'gap', mode: 'gap', monoSpanUs: [900000, 1100000], start: null, end: null, anchors: [] }, { ...structuredClone(start), id: 'c1', monoSpanUs: [1100000, 3000000] }]
    f.input.samples = f.input.samples.filter(s => s.monoUs < 900000 || s.monoUs > 1100000).map(s => ({ ...s, clockSegmentRef: s.monoUs > 1100000 ? 'c1' : 'c0' }))
    expect(() => optimizeMotionDraft(f.input)).toThrow('缺口')
    const unknown = createMotionFixture('S01'); unknown.input.samples[1].clockSegmentRef = 'unknown'; expect(() => optimizeMotionDraft(unknown.input)).toThrow('未知时钟段')
  })
  it('rotation domain, nonuniform video scaling and unsupported recipes are rejected without clamps', () => {
    expect(unwrapRotationTurns([170 / 360, -170 / 360])).toEqual([170 / 360, 190 / 360])
    const f = createMotionFixture('S11'); f.input.samples[4].pose.rotationTurns = 2; f.input.samples[5].pose.rotationTurns = 2
    expect(optimizeMotionDraft(f.input).candidates).toHaveLength(0)
    const scaled = createMotionFixture('S08'); scaled.input.samples[4].pose.scaleXY = [1, 2]; scaled.input.samples[5].pose.scaleXY = [1, 2]
    expect(optimizeMotionDraft(scaled.input).candidates).toHaveLength(0)
    expect(motionIntentSchema.safeParse({ kind: 'cycle', expression: 'script' }).success).toBe(false)
    const times = scalarCurveExtremaTimes([{ time: 0, value: 0, interpolation: 'bezier', bezier: [.001, 4, .002, -2] }, { time: 1, value: 1, interpolation: 'linear' }])
    expect(times).toHaveLength(2)
    expect(times[0]).toBeLessThan(.25)
    expect(evaluateVideoEditKeyframes([{ time: 0, value: 0, interpolation: 'bezier', bezier: [.001, 4, .002, -2] }, { time: 1, value: 1, interpolation: 'linear' }], times[0], -99)).toBeGreaterThan(1)
  })
  it('cancellation is checked within work and between streamed batches; no final partial result is implied', async () => {
    let checks = 0; const f = createMotionFixture('S02')
    expect(() => optimizeMotionDraft(f.input, { cancelled: () => ++checks > 2 })).toThrow('取消')
    async function* source(): AsyncGenerator<typeof f.input> { yield f.input; yield { ...f.input, mappings: { take0: fixtureMapping } } }
    let cancelled = false; const reader = optimizeMotionBatches(source(), { cancelled: () => cancelled, checkpoint: async () => undefined })
    expect((await reader.next()).value?.partial).toBe(true); cancelled = true; await expect(reader.next()).rejects.toThrow('取消')
    expect(() => checkCancelled({ cancelled: () => true })).toThrow('取消')
  })
})
