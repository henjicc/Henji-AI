import fc from 'fast-check'
import type { MotionDraft, MotionSample, Pose } from '../contracts'
import type { MotionIntent } from '../recipe'
import type { OptimizeMotionInput } from '../candidates'
import type { MotionCompileContext } from '../motionCompiler'
import type { LayoutItem } from '../layout'
import type { LayoutConstraint } from '../contracts'

export const fixtureDigest = `sha256:${'a'.repeat(64)}`
export const fixtureOwner = { kind: 'document.video_edit', id: 'fixture:doc' }
export const fixtureTarget = { kind: 'video_edit.clip', id: 'fixture:doc:clip' }
export const fixtureSequence = { kind: 'video_edit.sequence', id: 'fixture:doc:sequence' }
export const fixtureMapping: MotionCompileContext = { clipStart: 0, positionToNative: [1, 0, 0, 1, 0, 0], pivotToNative: [1, 0, 0, 1, 0, 0], scaleFactor: 1, rotationOffsetDegrees: 0 }
const A: [number, number] = [.15, .5]; const B: [number, number] = [.75, .5]
const h = (t: number): number => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const bezier = (a: number[], b: number[], c: number[], d: number[], t: number): [number, number] => [0, 1].map(i => (1 - t) ** 3 * a[i] + 3 * (1 - t) ** 2 * t * b[i] + 3 * (1 - t) * t * t * c[i] + t ** 3 * d[i]) as [number, number]
const pose = (position: [number, number], scale = 1, turns = 0): Pose => ({ position, scaleXY: [scale, scale], rotationTurns: turns, pivot: [.5, .5] })
const piecewise = (t: number, knots: readonly [number, number][]): number => {
  for (let i = 1; i < knots.length; i++) if (t <= knots[i][0]) return lerp(knots[i - 1][1], knots[i][1], h((t - knots[i - 1][0]) / (knots[i][0] - knots[i - 1][0])))
  return knots[knots.length - 1][1]
}
export interface MotionFixture { id: string; duration: number; input: OptimizeMotionInput; reference: (seconds: number) => Pose; events: { frame: number; kind: 'dwell-start' | 'dwell-end' | 'turn' }[]; kRange?: [number, number]; noisy: boolean; expectedPrimitive: string }

/** References are independent analytic functions fixed from 03 §5 before compiler measurements. */
export function createMotionFixture(id: string, options: { speed?: number; fps?: { numerator: number; denominator: number }; noisy?: boolean; duration?: number } = {}): MotionFixture {
  let duration = options.duration ?? 2; let expectedPrimitive = 'follow_path'; let kRange: [number, number] | undefined
  let events: MotionFixture['events'] = []
  let reference: MotionFixture['reference'] = t => pose([lerp(A[0], B[0], t / duration), .5])
  let intent: MotionIntent | undefined
  if (id === 'S01') { expectedPrimitive = 'move_line'; kRange = [2, 4]; intent = { kind: 'move_line', from: A, to: B } }
  if (id === 'S02' || id === 'S10') {
    duration = 3; expectedPrimitive = 'follow_path+dwell'; kRange = [6, 12]
    reference = t => pose(t <= 1.2 ? bezier(A, [.3, .1], [.45, .2], [.5, .35], t / 1.2) : t <= 1.7 ? [.5, .35] : bezier([.5, .35], [.55, .55], [.65, .6], B, (t - 1.7) / 1.3))
    events = [{ frame: 72, kind: 'dwell-start' }, { frame: 102, kind: 'dwell-end' }]
  }
  if (id === 'S03' || id === 'S04') {
    duration = id === 'S03' ? .8 : 1.5; expectedPrimitive = id === 'S03' ? 'overshoot' : 'spring_settle'; kRange = id === 'S03' ? [4, 8] : [8, 16]
    const knots: [number, number][] = id === 'S03' ? [[0, 0], [.5, 1.08], [.8, 1]] : [[0, 0], [.27, 1.10], [.51, .96], [.75, 1.02], [1.05, 1], [1.5, 1]]
    reference = t => pose([A[0] + .6 * piecewise(t, knots), .5])
    events = knots.slice(1, -1).map(([t]) => ({ frame: Math.round(t * 60), kind: 'turn' }))
    if (id === 'S03') intent = { kind: 'overshoot', from: A, to: B, amountRatio: .08, settleFraction: .625 }
  }
  if (id === 'S05') { reference = t => pose([t <= 1 ? lerp(A[0], B[0], h(t)) : lerp(B[0], A[0], h(t - 1)), .5]); events = [{ frame: 60, kind: 'turn' }]; kRange = [5, 10] }
  if (id === 'S06') { duration = 4; reference = t => pose([.5 + .03 * Math.sin(Math.PI * t), .5 + .02 * Math.cos(Math.PI * t)]); expectedPrimitive = 'unclassified-path' }
  if (id === 'S07') { duration = 5; reference = t => pose([.5, .5], 1 + .08 * Math.max(0, ...[.6, 1.6, 2.6, 3.6].map(p => 1 - Math.abs(t - p) / .12))); events = [.6, 1.6, 2.6, 3.6].map(t => ({ frame: t * 60, kind: 'turn' })); expectedPrimitive = 'unclassified-path' }
  if (id === 'S08') {
    expectedPrimitive = 'scale_focus'; kRange = [2, 6]
    reference = t => { const s = 1 + .3 * h(t / 2); return pose([.62 + (A[0] - .62) * s, .41 + (A[1] - .41) * s], s) }
    intent = { kind: 'scale_focus', focus: [.62, .41], fromScaleXY: [1, 1], toScaleXY: [1.3, 1.3] }
  }
  if (id === 'S11') {
    reference = t => t <= .6 ? pose([.15 + .2 * h(t / .6), .5], 1, 170 / 360) : t <= 1.2 ? pose([.35, .5], 1, (170 + 20 * h((t - .6) / .6)) / 360) : pose([.35 + .2 * h((t - 1.2) / .8), .5], 1 + .2 * h((t - 1.2) / .8), 190 / 360)
    events = [{ frame: 36, kind: 'turn' }, { frame: 72, kind: 'turn' }]; kRange = [8, 16]
  }
  if (id === 'S15') {
    duration = 6; reference = t => { const a = t <= 2 ? Math.PI * t : t <= 2.5 ? 2 * Math.PI : 2 * Math.PI * (6 - t) / 3.5; return pose([.5 + .2 * Math.sin(a), .5 + .1 * Math.sin(2 * a)]) }
    events = [{ frame: 120, kind: 'dwell-start' }, { frame: 150, kind: 'dwell-end' }]; kRange = [12, 24]
  }
  if (id === 'S16') { reference = t => pose([.5 + .002 * 2160 / 3840 * Math.sin(16 * Math.PI * t), .5]); expectedPrimitive = 'intentional-jitter'; intent = { kind: 'follow_path', preserveJitter: true } }
  const fps = options.fps ?? { numerator: 60, denominator: 1 }; const rate = fps.numerator / fps.denominator
  events = events.map(e => ({ ...e, frame: Math.round(e.frame / 60 * rate) }))
  const speed = options.speed ?? 1; const endFrame = Math.round(duration * rate)
  const phase = fc.sample(fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), { seed: 14001, numRuns: 3 })
  const samples: MotionSample[] = []
  for (let i = 0; i <= Math.round(duration * 120 / speed); i++) {
    const frame = Math.min(endFrame, Math.floor(i * speed * rate / 120 + 1e-9)); const t = frame / rate
    const value = reference(Math.min(duration, t)); const event = events.find(e => e.frame === frame)
    if (options.noisy && frame !== 0 && frame !== endFrame && !event && !(id === 'S02' && t >= 1.2 && t <= 1.7)) {
      // 60% high-band component, fixed phases, short-edge amplitude <=0.1%.
      value.position[0] += .001 * 2160 / 3840 * (.6 * Math.sin(2 * Math.PI * 14 * t + phase[0]) + .4 * Math.sin(2 * Math.PI * 4 * t + phase[1]))
    }
    samples.push({ sampleId: `s:${i}`, seq: i, monoUs: Math.round(i / 120 * 1e6), timeline: { sequenceRef: fixtureSequence, frame, fps, visitRef: 'v0' }, clockSegmentRef: 'c0', takeRef: 'take0', targetRef: fixtureTarget, pose: value, gestureKind: 'place', quality: 'presented', confirmed: true, event: i === 0 ? 'down' : i === Math.round(duration * 120 / speed) ? 'up' : event?.kind ?? 'sample' })
  }
  const properties: MotionDraft['targets'][number]['editable'] = id === 'S08' || id === 'S07' ? ['position', 'scaleXY'] : id === 'S11' ? ['position', 'rotationTurns', 'scaleXY'] : ['position']
  const draft: MotionDraft = { id, version: 1, ownerRef: fixtureOwner, mode: 'animated', label: id, fidelity: 0, sourceDigest: fixtureDigest, clockSegments: [{ id: 'c0', mode: 'scrub', monoSpanUs: [0, samples[samples.length - 1].monoUs], start: samples[0].timeline, end: samples[samples.length - 1].timeline, anchors: [] }], targets: [{ ref: fixtureTarget, ownerRef: fixtureOwner, editable: properties, basePose: reference(0), baseDigest: fixtureDigest, geometryDigest: fixtureDigest, compositionSize: [3840, 2160] }], takes: [{ id: 'take0', intent: 'demonstrate', pathDemonstration: false, monoSpanUs: [0, samples[samples.length - 1].monoUs], direction: 1, visitRef: 'v0', timelineRange: [0, endFrame], samplePages: [], geometryDigest: fixtureDigest }], pins: [{ id: 'pin:start', sampleId: samples[0].sampleId, targetRef: fixtureTarget, properties, timeLocked: true, valueLocked: true }, { id: 'pin:end', sampleId: samples[samples.length - 1].sampleId, targetRef: fixtureTarget, properties, timeLocked: true, valueLocked: true }], constraints: [], recipeRefs: [], candidateRefs: [], applications: [] }
  return { id, duration, input: { draft, samples, mappings: { take0: fixtureMapping }, intent }, reference, events, kRange, noisy: options.noisy ?? false, expectedPrimitive }
}

export function createLayoutFixture(count = 4): { items: LayoutItem[]; constraints: LayoutConstraint[] } {
  const items: LayoutItem[] = []
  for (let i = 0; i < count; i++) {
    const widths = [.18, .23, .15]; const heights = [.22, .18, .25]; const w = widths[i % 3]; const h = heights[i % 3]
    const x = count === 4 ? [.2, .46, .77, .5][i] : i * .3; const y = count === 4 ? [.6, .63, .58, .22][i] : .6 + .01 * (i % 3)
    items.push({ targetRef: { kind: 'image_edit.layer', id: `layout:${i}` }, affine: [1, 0, 0, 1, x, y], worldCorners: [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]], translationLocked: i === 0 || count === 4 && i === 3 })
  }
  const targets = items.slice(0, count === 4 ? 3 : count).map(i => i.targetRef)
  const constraints: LayoutConstraint[] = [{ id: 'top', kind: 'align', targets, reference: targets[0], axis: 'y', edge: 'start', strength: 'hard', sourceRefs: [] }, { id: 'gap', kind: 'distribute', targets, axis: 'x', strength: 'soft', sourceRefs: [], gapRatio: .06 }]
  return { items, constraints }
}
