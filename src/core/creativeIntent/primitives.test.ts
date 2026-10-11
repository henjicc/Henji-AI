import { afterAll, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { primitiveFixtures } from './fixtures/primitiveFixtures'
import { fixtureMapping } from './fixtures/motionFixtures'
import { compileMotionTake, compileMotionRecipe } from './motionCompiler'
import { recognizeMotionPrimitives, detectMotionCycle, windowedFeatureDistance } from './recognition'
import { scalarCurveExtremaTimes } from './fitting'
import { motionIntentSchema, type MotionIntent } from './recipe'
import { evaluateVideoEditKeyframes } from '../videoEdit/keyframes'
import { mergeMotionClipCurves } from '../videoEdit/motionDraft'
import { videoEditClipSchema } from '../videoEdit/document'

const rows: Record<string, unknown>[] = []
const fixtures = primitiveFixtures()
afterAll(() => { if (process.env.HENJI_P2_BENCH_DIR) writeFileSync(join(process.env.HENJI_P2_BENCH_DIR, 'primitives.json'), JSON.stringify(rows, null, 2)) })
describe('P2 primitives evidence and native compiler', () => {
  for (const f of fixtures) it(f.kind + ': independent reference, classification, refusal and native error', () => {
    const before = JSON.stringify(f.take)
    const scores = (['rules', 'dtw'] as const).map(method => {
      const started = performance.now(); const result = recognizeMotionPrimitives(f.take, method); const ms = performance.now() - started
      const absent = { ...f.take, points: [f.take.points[0], f.take.points.at(-1)!] }
      const noEvidence = recognizeMotionPrimitives(absent, method)
      // Same endpoints with too little interior evidence must never fabricate the labelled primitive.
      const confusion = structuredClone(f.take)
      confusion.points.forEach((point, index) => { const t = index / 240; point.pose.position[0] += .04 * t; point.pose.rotationTurns += .12 * t; point.pose.scaleXY = point.pose.scaleXY.map(v => v + .1 * t) as [number, number] })
      const ambiguous = recognizeMotionPrimitives(confusion, method)
      return { method, top1: !result.rejected && result.candidates[0]?.kind === f.kind, top3: result.candidates.some(c => c.kind === f.kind), rejected: result.rejected, distance: result.candidates[0]?.distance, noEvidenceRefused: noEvidence.rejected, confusionRefused: ambiguous.rejected, ms }
    })
    const compiled = compileMotionTake(f.take, fixtureMapping, { fidelity: 0, intent: f.intent })
    let maxError = 0; let peakError = 0; let peakTimeError = 0
    for (let frame = 0; frame <= 240; frame += .25) {
      const expected = f.reference(frame / 240)
      const actual = [evaluateVideoEditKeyframes(compiled.curves.x, frame, 0), evaluateVideoEditKeyframes(compiled.curves.y, frame, 0)]
      maxError = Math.max(maxError, Math.hypot(Number(actual[0]) - expected.position[0], Number(actual[1]) - expected.position[1]))
    }
    for (let i = 1; i < 240; i++) for (const axis of [0, 1] as const) {
      const v = f.take.points[i].pose.position[axis]; const a = f.take.points[i - 1].pose.position[axis]; const b = f.take.points[i + 1].pose.position[axis]
      if ((v - a) * (b - v) < 0) {
        peakError = Math.max(peakError, Math.abs(Number(evaluateVideoEditKeyframes(compiled.curves[axis ? 'y' : 'x'], i, 0)) - v))
        const curve = compiled.curves[axis ? 'y' : 'x']!
        const extrema = [...scalarCurveExtremaTimes(curve), ...curve.map(p => p.time).filter(time => {
          const left = Number(evaluateVideoEditKeyframes(curve, time - .1, 0)); const value = Number(evaluateVideoEditKeyframes(curve, time, 0)); const right = Number(evaluateVideoEditKeyframes(curve, time + .1, 0))
          return (value - left) * (right - value) < 0
        })]
        peakTimeError = Math.max(peakTimeError, Math.min(...extrema.map(time => Math.abs(time - i))))
      }
    }
    rows.push({ primitive: f.kind, scores, K: compiled.keyCount, maxPositionError: maxError, peakValueError: peakError, peakTimeErrorFrames: peakTimeError, maxErrors: compiled.maxErrors })
    expect(maxError).toBeLessThan(.0005); expect(peakError).toBeLessThan(.0005)
    expect(peakTimeError).toBeLessThanOrEqual(1)
    expect(scores.every(s => s.noEvidenceRefused && s.confusionRefused)).toBe(true)
    expect(scores[0].top1, JSON.stringify(scores)).toBe(true)
    expect(JSON.stringify(f.take)).toBe(before)
    expect(Object.values(compiled.curves).flat().every(p => ['hold', 'linear', 'bezier', 'ease'].includes(p.interpolation))).toBe(true)
  })
  it('a horizontal single parabola is indistinguishable arc/bounce and stays unresolved', () => {
    const f = { ...fixtures[0], take: structuredClone(fixtures[0].take) }
    f.take.points.forEach(point => { const t = point.frame / 240; point.pose.position[1] -= .4 * t * (1 - t) })
    for (const method of ['rules', 'dtw'] as const) {
      const result = recognizeMotionPrimitives(f.take, method)
      expect(result.rejected).toBe(true); expect(result.candidates.map(c => c.kind)).toEqual(expect.arrayContaining(['move_arc', 'bounce']))
    }
  })
  it('vertical-only scale and moving pivots are not stationary evidence', () => {
    const stationary = fixtures.find(f => f.kind === 'dwell')!
    for (const channel of ['scale', 'pivot'] as const) {
      const take = structuredClone(stationary.take)
      take.points.forEach(point => {
        const t = point.frame / 240
        if (channel === 'scale') point.pose.scaleXY[1] += .2 * t
        else point.pose.pivot[1] += .1 * t
      })
      for (const method of ['rules', 'dtw'] as const) {
        const result = recognizeMotionPrimitives(take, method)
        expect(result.candidates.some(candidate => candidate.kind === 'dwell')).toBe(false)
        if (channel === 'pivot') expect(result.rejected).toBe(true)
      }
    }
  })
  it('spatial arc controls are not time easing; explicit timing only remaps progress', () => {
    const f = fixtures.find(f => f.kind === 'move_arc')!
    const linear = compileMotionTake(f.take, fixtureMapping, { fidelity: 0, intent: f.intent })
    const eased = compileMotionTake(f.take, fixtureMapping, { fidelity: 0, intent: { ...f.intent, timing: { kind: 'bezier', bezier: [1 / 3, 0, 2 / 3, 1] } } })
    expect(evaluateVideoEditKeyframes(linear.curves.y, 120, 0)).toBeCloseTo(.38, 4)
    expect(evaluateVideoEditKeyframes(eased.curves.x, 60, 0)).toBeCloseTo(.31484375, 4)
  })
  it('cycle closure, two periods, pingpong turn and native seam velocity', () => {
    const orbit = fixtures.find(f => f.kind === 'orbit')!
    const template = { ...orbit.intent, sweepTurns: 1 } as Extract<MotionIntent, { kind: 'orbit' }>
    const intent: MotionIntent = { kind: 'cycle', template, mode: 'loop', periodFrames: 120 }
    const compiled = compileMotionTake(orbit.take, fixtureMapping, { fidelity: 0, intent })
    const value = (frame: number, key: 'x' | 'y'): number => Number(evaluateVideoEditKeyframes(compiled.curves[key], frame, 0))
    const delta = .001
    const errors = ['x', 'y'].map(k => { const key = k as 'x' | 'y'; return Math.abs((value(120, key) - value(120 - delta, key)) / delta - (value(120 + delta, key) - value(120, key)) / delta) })
    rows.push({ cycle: 'orbit-two-periods', K: compiled.keyCount, seamVelocityError: errors })
    expect(Math.max(...errors)).toBeLessThan(.0001)
    expect(recognizeMotionPrimitives(orbit.take).cycle?.periodFrames).toBe(120)
    const line = fixtures[0]
    const pingpong = compileMotionTake(line.take, fixtureMapping, { fidelity: 0, intent: { kind: 'cycle', template: line.intent, mode: 'pingpong', periodFrames: 120 } })
    expect(evaluateVideoEditKeyframes(pingpong.curves.x, 60, 0)).toBeCloseTo(.8)
    expect(evaluateVideoEditKeyframes(pingpong.curves.x, 120, 0)).toBeCloseTo(.2)
    const demonstrated = structuredClone(line.take)
    demonstrated.points.forEach(point => { const t = point.frame / 240; const u = t <= .5 ? t * 2 : 2 - t * 2; point.pose.position[0] = .2 + .6 * (u * u * (3 - 2 * u)) })
    expect(detectMotionCycle(demonstrated)?.mode).toBe('pingpong')
    expect(detectMotionCycle(line.take)).toBeUndefined()
    expect(() => compileMotionTake(line.take, fixtureMapping, { fidelity: 0, intent: { kind: 'cycle', template: line.intent, mode: 'loop', periodFrames: 120 } })).toThrow('接缝')
    expect(() => compileMotionTake(line.take, fixtureMapping, { fidelity: 0, intent: { ...intent, periodFrames: 128 } })).toThrow('截断')
  })
  it('unknown fields, targets, overlapping actions, excessive turns, frequencies and pins reject explicitly', () => {
    const f = fixtures[0]
    expect(motionIntentSchema.safeParse({ ...f.intent, unknown: 1 }).success).toBe(false)
    const action = { target: 'primitive', spanF: [0, 240] as [number, number], intent: f.intent }
    expect(() => compileMotionRecipe({ actions: [{ ...action, target: 'missing' }] }, [f.take], { primitive: fixtureMapping }, 0)).toThrow('目标')
    expect(() => compileMotionRecipe({ actions: [action, action] }, [f.take], { primitive: fixtureMapping }, 0)).toThrow('重叠')
    const spin = fixtures.find(f => f.kind === 'spin')!
    expect(() => compileMotionTake(spin.take, fixtureMapping, { fidelity: 0, intent: { kind: 'spin', pivot: [.5, .5], startTurns: 0, sweepTurns: 2 } })).toThrow('范围')
    expect(() => compileMotionTake(f.take, fixtureMapping, { fidelity: 0, intent: { kind: 'bounce', from: [.2, .5], to: [.8, .5], count: 1000, decay: 1, heightRatio: .1 } })).toThrow('帧网格')
    const pinned = structuredClone(f.take); pinned.pins.push({ point: pinned.points[120], pin: { id: 'pin', sampleId: 'primitive:120', targetRef: pinned.target.ref, properties: ['position'], timeLocked: true, valueLocked: true } }); pinned.points[120].hard = true
    expect(() => compileMotionTake(pinned, fixtureMapping, { fidelity: 0, intent: { kind: 'move_line', from: [.2, .5], to: [.9, .5] } })).toThrow('钉住')
    expect(() => windowedFeatureDistance([[0]], [[0]], 1, { cancelled: () => true })).toThrow('取消')
  })
  it('short periods use distinguishable native extrema rather than a blanket eight-frame limit', () => {
    const f = fixtures[0]
    const short = (frames: number) => ({ ...f.take, points: [f.take.points[0], { ...f.take.points.at(-1)!, frame: frames }] })
    const bounce = compileMotionTake(short(2), fixtureMapping, { fidelity: 0, intent: { kind: 'bounce', from: [.2, .5], to: [.8, .5], count: 1, decay: 1, heightRatio: .1 } })
    expect(evaluateVideoEditKeyframes(bounce.curves.y, 1, 0)).toBeCloseTo(.4)
    const pulse = compileMotionTake(short(2), fixtureMapping, { fidelity: 0, intent: { kind: 'pulse', baseScaleXY: [1, 1], amountRatio: .2, cycles: 1 } })
    expect(evaluateVideoEditKeyframes(pulse.curves.scale, 1, 0)).toBeCloseTo(1.2)
    expect(() => compileMotionTake(short(4), fixtureMapping, { fidelity: 0, intent: { kind: 'orbit', center: [.5, .5], radiusXY: [.12, .12], startTurns: 0, sweepTurns: 1 } })).toThrow('误差预算')
    const orbit = compileMotionTake(short(4), fixtureMapping, { fidelity: 0, intent: { kind: 'orbit', center: [.5, .5], radiusXY: [.012, .012], startTurns: 0, sweepTurns: 1 } })
    expect(evaluateVideoEditKeyframes(orbit.curves.y, 1, 0)).toBeCloseTo(.512)
    const pingpong = compileMotionTake(short(2), fixtureMapping, { fidelity: 0, intent: { kind: 'cycle', mode: 'pingpong', periodFrames: 2, template: f.intent } })
    expect(evaluateVideoEditKeyframes(pingpong.curves.x, 1, 0)).toBeCloseTo(.8)
    expect(() => compileMotionTake(short(1), fixtureMapping, { fidelity: 0, intent: { kind: 'bounce', from: [.2, .5], to: [.8, .5], count: 1, decay: 1, heightRatio: .1 } })).toThrow('帧网格')
  })
  it('batch recipes preserve target editability and detect overlap across aliases of one object', () => {
    const f = fixtures[0]
    const restricted = { ...f.take, target: { ...f.take.target, editable: ['position' as const] } }
    expect(() => compileMotionRecipe({ actions: [{ target: 'primitive', spanF: [0, 240], intent: { kind: 'spin', pivot: [.5, .5], startTurns: 0, sweepTurns: .5 } }] }, [restricted], { primitive: fixtureMapping }, 0)).toThrow('可编辑域')
    const alias = { ...f.take, takeId: 'alias' }
    expect(() => compileMotionRecipe({ actions: [{ target: 'primitive', spanF: [0, 240], intent: f.intent }, { target: 'alias', spanF: [0, 240], intent: f.intent }] }, [f.take, alias], { primitive: fixtureMapping, alias: fixtureMapping }, 0)).toThrow('重叠')
  })
  it('ordinary curve mutation and original merge remain the sole result and undo input', () => {
    const f = fixtures.find(f => f.kind === 'bounce')!
    const motion = compileMotionTake(f.take, fixtureMapping, { fidelity: 0, intent: f.intent })
    const clip = videoEditClipSchema.parse({ id: 'clip', itemId: 'item', kind: 'image', name: '素材', text: '', start: 0, duration: 241, track: 1, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, anchorX: .5, anchorY: .5 })
    const applied = mergeMotionClipCurves(clip, [motion])
    expect(applied.curves?.y?.some(p => p.interpolation === 'bezier')).toBe(true)
    expect(clip).not.toHaveProperty('curves')
  })
})
