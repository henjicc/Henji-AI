import type { Pose } from '../contracts'
import type { PrimitiveIntent } from '../recipe'
import type { PreparedTake } from '../sampling'
import { fixtureDigest, fixtureOwner, fixtureTarget } from './motionFixtures'

const pose = (x = .2, y = .5, scale = 1, rotation = 0): Pose => ({ position: [x, y], scaleXY: [scale, scale], rotationTurns: rotation, pivot: [.5, .5] })
const h = (t: number): number => t * t * (3 - 2 * t)
export interface PrimitiveFixture { kind: PrimitiveIntent['kind']; intent: PrimitiveIntent; reference: (t: number) => Pose; take: PreparedTake }
/** Independent analytic references; labels/parameters fixed before classifier measurement. */
export function primitiveFixtures(): PrimitiveFixture[] {
  const from: [number, number] = [.2, .5]; const to: [number, number] = [.8, .5]
  const defs: { kind: PrimitiveIntent['kind']; intent: PrimitiveIntent; reference: (t: number) => Pose }[] = [
    { kind: 'move_line', intent: { kind: 'move_line', from, to }, reference: t => pose(.2 + .6 * t) },
    { kind: 'move_arc', intent: { kind: 'move_arc', from: [.2, .4], to: [.8, .6], bendRatio: -.2 }, reference: t => pose(.2 + .6 * t + .16 * t * (1 - t), .4 + .2 * t - .48 * t * (1 - t)) },
    { kind: 'follow_path', intent: { kind: 'follow_path', preserveJitter: false }, reference: t => pose(.2 + .6 * t + .05 * Math.sin(8 * Math.PI * t), .5 + .13 * Math.sin(6 * Math.PI * t) * Math.sin(Math.PI * t)) },
    { kind: 'orbit', intent: { kind: 'orbit', center: [.5, .5], radiusXY: [.2, .1], startTurns: 0, sweepTurns: 2 }, reference: t => pose(.5 + .2 * Math.cos(4 * Math.PI * t), .5 + .1 * Math.sin(4 * Math.PI * t)) },
    { kind: 'overshoot', intent: { kind: 'overshoot', from, to, amountRatio: .1, settleFraction: .625 }, reference: t => pose(.2 + .6 * (t <= .625 ? 1.1 * h(t / .625) : 1 + .1 * (1 - h((t - .625) / .375)))) },
    { kind: 'bounce', intent: { kind: 'bounce', from, to, heightRatio: .15, count: 3, decay: 1 }, reference: t => { const u = t === 1 ? 1 : t * 3 % 1; return pose(.2 + .6 * t, .5 - .6 * u * (1 - u)) } },
    { kind: 'spring_settle', intent: { kind: 'spring_settle', from, to, damping: 4, cycles: 3 }, reference: t => pose(.2 + .6 * (1 - Math.exp(-4 * t) * Math.cos(6 * Math.PI * t) + Math.exp(-4) * h(t))) },
    { kind: 'swing', intent: { kind: 'swing', pivot: [.5, .5], amplitudeTurns: .08, cycles: 2, decay: 1 }, reference: t => pose(.2, .5, 1, .08 * Math.sin(4 * Math.PI * t)) },
    { kind: 'pulse', intent: { kind: 'pulse', baseScaleXY: [1, 1], amountRatio: .2, cycles: 2 }, reference: t => pose(.2, .5, 1 + .1 * (1 - Math.cos(4 * Math.PI * t))) },
    { kind: 'spin', intent: { kind: 'spin', pivot: [.5, .5], startTurns: 0, sweepTurns: .75 }, reference: t => pose(.2, .5, 1, .75 * t) },
    { kind: 'sway', intent: { kind: 'sway', center: [.2, .5], axis: [1, 0], amplitudeRatio: .06, cycles: 2 }, reference: t => pose(.2 + .06 * Math.sin(4 * Math.PI * t)) },
    { kind: 'zigzag', intent: { kind: 'zigzag', from, to, amplitudeRatio: .1, count: 4 }, reference: t => { const k = Math.min(3, Math.floor(t * 4)); const u = t * 4 - k; const a = [0, 1, -1, 1, 0]; return pose(.2 + .6 * t, .5 + .1 * (a[k] * (1 - u) + a[k + 1] * u)) } },
    { kind: 'scale_focus', intent: { kind: 'scale_focus', focus: [.6, .4], fromScaleXY: [1, 1], toScaleXY: [1.3, 1.3] }, reference: t => { const s = 1 + .3 * h(t); return pose(.6 - .4 * s, .4 + .1 * s, s) } },
    { kind: 'dwell', intent: { kind: 'dwell', pose: pose() }, reference: () => pose() },
  ]
  return defs.map(def => {
    const base = def.reference(0)
    const take: PreparedTake = { takeId: 'primitive', target: { ref: fixtureTarget, ownerRef: fixtureOwner, editable: ['position', 'rotationTurns', 'scaleXY', 'pivot'], basePose: base, baseDigest: fixtureDigest, geometryDigest: fixtureDigest, compositionSize: [3840, 2160] }, pins: [], points: Array.from({ length: 241 }, (_, frame) => ({ frame, pose: def.reference(frame / 240), sampleIds: ['primitive:' + frame], hard: frame === 0 || frame === 240 })) }
    return { ...def, take }
  })
}
