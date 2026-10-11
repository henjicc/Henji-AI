import type { PreparedTake } from './sampling'

export interface MotionEvidence { kind: 'dwell' | 'overshoot'; frames: [number, number]; sampleIds: string[] }
/** Conservative P1 evidence. No cycle/spring classification or inferred animation from wall-clock holds. */
export function recognizeMotionEvidence(take: PreparedTake): MotionEvidence[] {
  const events: MotionEvidence[] = []; const p = take.points
  let start = -1
  const same = (a: number, b: number): boolean => JSON.stringify(p[a].pose) === JSON.stringify(p[b].pose)
  for (let i = 1; i < p.length; i++) {
    if (same(i - 1, i) && start < 0) start = i - 1
    if (start >= 0 && (!same(i - 1, i) || i === p.length - 1)) {
      const end = same(i - 1, i) ? i : i - 1
      if (end > start && p[end].frame > p[start].frame) events.push({ kind: 'dwell', frames: [p[start].frame, p[end].frame], sampleIds: [...p[start].sampleIds, ...p[end].sampleIds] })
      start = -1
    }
  }
  if (p.length < 3) return events
  const from = p[0].pose.position; const to = p[p.length - 1].pose.position; const dx = to[0] - from[0]; const dy = to[1] - from[1]; const distance = dx * dx + dy * dy
  if (distance < 1e-8) return events
  const projection = p.map(v => ((v.pose.position[0] - from[0]) * dx + (v.pose.position[1] - from[1]) * dy) / distance)
  const peak = projection.reduce((max, v) => Math.max(max, v), -Infinity); const i = projection.indexOf(peak)
  if (peak > 1.005 && i > 0 && i < p.length - 1) events.push({ kind: 'overshoot', frames: [p[i].frame, p[i].frame], sampleIds: p[i].sampleIds })
  return events
}

import { intentPose, type PrimitiveIntent, type MotionIntent } from './recipe'
import { checkCancelled, type ComputationControl } from './sampling'
import type { Pose } from './contracts'

export interface PrimitiveRecognition {
  candidates: { kind: PrimitiveIntent['kind']; intent: PrimitiveIntent; distance: number }[]
  rejected: boolean; reason?: string
  cycle?: Extract<MotionIntent, { kind: 'cycle' }>
}
const tau = 2 * Math.PI
const range = (v: number[]): number => Math.max(...v) - Math.min(...v)
function turns(v: number[]): number[] {
  const out: number[] = []; let direction = 0
  for (let i = 1; i < v.length; i++) {
    const delta = v[i] - v[i - 1]
    if (Math.abs(delta) < Math.max(1e-7, range(v) * .001)) continue
    if (direction && Math.sign(delta) !== direction) out.push(i - 1)
    direction = Math.sign(delta)
  }
  return out
}
/** Linear-memory Sakoe-Chiba band. Features share one normalization, never each axis separately. */
export function windowedFeatureDistance(a: readonly number[][], b: readonly number[][], window: number, control: ComputationControl = {}): number {
  let previous = new Float64Array(b.length + 1).fill(Infinity); previous[0] = 0
  for (let i = 1; i <= a.length; i++) {
    checkCancelled(control); const current = new Float64Array(b.length + 1).fill(Infinity)
    for (let j = Math.max(1, i - window); j <= Math.min(b.length, i + window); j++) {
      const cost = a[i - 1].reduce((sum, v, k) => sum + (v - b[j - 1][k]) ** 2, 0)
      current[j] = cost + Math.min(previous[j], previous[j - 1], current[j - 1])
    }
    previous = current
  }
  return Math.sqrt(previous[b.length] / Math.max(a.length, b.length))
}
/** Resampling is a classifier feature budget; original pages and compiler timing remain untouched. */
function resample(take: PreparedTake): Pose[] {
  const first = take.points[0].frame; const span = take.points.at(-1)!.frame - first
  let index = 0
  return Array.from({ length: 65 }, (_, i) => {
    const frame = first + span * i / 64
    while (index + 1 < take.points.length - 1 && take.points[index + 1].frame < frame) index++
    const a = take.points[index]; const b = take.points[Math.min(index + 1, take.points.length - 1)]
    const t = b.frame === a.frame ? 0 : (frame - a.frame) / (b.frame - a.frame)
    return { position: a.pose.position.map((v, k) => v + (b.pose.position[k] - v) * t) as [number, number], scaleXY: a.pose.scaleXY.map((v, k) => v + (b.pose.scaleXY[k] - v) * t) as [number, number], rotationTurns: a.pose.rotationTurns + (b.pose.rotationTurns - a.pose.rotationTurns) * t, pivot: [...a.pose.pivot] }
  })
}
function features(poses: Pose[], origin: Pose, normalization: number[]): number[][] {
  const values = poses.map(p => [p.position[0] - origin.position[0], p.position[1] - origin.position[1], p.rotationTurns - origin.rotationTurns, Math.log(p.scaleXY[0] / origin.scaleXY[0]), Math.log(p.scaleXY[1] / origin.scaleXY[1])].map((v, i) => v / normalization[i]))
  return values.map((v, i) => {
    const d = v.map((x, k) => i ? (x - values[i - 1][k]) * 4 : 0)
    const speed = Math.hypot(...d)
    return [...v, ...d, speed, speed < .0001 ? .04 : 0]
  })
}
/** Rules establish admissible hypotheses; DTW ranks evidence but never proves preserved timing. */
export function recognizeMotionPrimitives(take: PreparedTake, method: 'rules' | 'dtw' = 'rules', control: ComputationControl = {}): PrimitiveRecognition {
  const reject = (reason: string): PrimitiveRecognition => ({ candidates: [], rejected: true, reason })
  if (take.points.length < 5 || take.points.at(-1)!.frame - take.points[0].frame < 4) return reject('示范不足，不能从端点推断动作')
  const p = resample(take); const base = p[0]; const last = p.at(-1)!
  const x = p.map(v => v.position[0]); const y = p.map(v => v.position[1]); const r = p.map(v => v.rotationTurns); const s = p.map(v => v.scaleXY[0])
  const spatial = Math.max(range(x), range(y)); const rotation = range(r); const scale = Math.max(range(s), range(p.map(v => v.scaleXY[1])))
  if (p.some(v => Math.hypot(v.pivot[0] - base.pivot[0], v.pivot[1] - base.pivot[1]) > .000001)) return reject('锚点在变化，请保留示范路径')
  const dx = last.position[0] - base.position[0]; const dy = last.position[1] - base.position[1]; const length = Math.hypot(dx, dy)
  const hypotheses: PrimitiveIntent[] = []
  if (spatial < 1e-6 && rotation < 1e-6 && scale < 1e-6) return { candidates: [{ kind: 'dwell', intent: { kind: 'dwell', pose: base }, distance: 0 }], rejected: false }
  if (spatial < .001 && rotation > .005 && scale < .001) {
    const extrema = turns(r)
    if (!extrema.length) hypotheses.push({ kind: 'spin', pivot: base.pivot, startTurns: base.rotationTurns, sweepTurns: last.rotationTurns - base.rotationTurns })
    else for (const decay of [1, .5, .1]) hypotheses.push({ kind: 'swing', pivot: base.pivot, amplitudeTurns: Math.max(...r.map(v => Math.abs(v - r[0]))), cycles: extrema.length / 2, decay })
  } else if (scale > .005 && rotation < .001) {
    const extrema = turns(s)
    if (extrema.length >= 1 && Math.abs(s.at(-1)! - s[0]) < scale * .05 && spatial < .001) hypotheses.push({ kind: 'pulse', baseScaleXY: base.scaleXY, amountRatio: scale / s[0], cycles: (extrema.length + 1) / 2 })
    if (!extrema.length) {
      const ratio = last.scaleXY[0] / base.scaleXY[0]
      const focus: [number, number] = ratio === 1 ? base.pivot : [(last.position[0] - ratio * base.position[0]) / (1 - ratio), (last.position[1] - ratio * base.position[1]) / (1 - ratio)]
      hypotheses.push({ kind: 'scale_focus', focus, fromScaleXY: base.scaleXY, toScaleXY: last.scaleXY, timingBlend: 1 }, { kind: 'scale_focus', focus, fromScaleXY: base.scaleXY, toScaleXY: last.scaleXY })
    }
  } else if (spatial > .003 && rotation < .001 && scale < .001) {
    const cx = (Math.min(...x) + Math.max(...x)) / 2; const cy = (Math.min(...y) + Math.max(...y)) / 2
    const rx = range(x) / 2; const ry = range(y) / 2
    if (rx > .002 && ry > .002) {
      const angles = p.map(v => Math.atan2((v.position[1] - cy) / ry, (v.position[0] - cx) / rx))
      let sweep = 0
      for (let i = 1; i < angles.length; i++) { let d = angles[i] - angles[i - 1]; while (d > Math.PI) d -= tau; while (d < -Math.PI) d += tau; sweep += d }
      const radialError = p.reduce((sum, v) => sum + Math.abs(Math.hypot((v.position[0] - cx) / rx, (v.position[1] - cy) / ry) - 1), 0) / p.length
      if (radialError < .06 && Math.abs(sweep) > Math.PI) hypotheses.push({ kind: 'orbit', center: [cx, cy], radiusXY: [rx, ry], startTurns: angles[0] / tau, sweepTurns: sweep / tau })
    }
    if (length > .003) {
      const projection = p.map(v => ((v.position[0] - base.position[0]) * dx + (v.position[1] - base.position[1]) * dy) / (length * length))
      const normal = p.map(v => (-(v.position[0] - base.position[0]) * dy + (v.position[1] - base.position[1]) * dx) / length)
      const peak = Math.max(...projection); const extrema = turns(projection)
      if (range(normal) < length * .02 && !extrema.length) hypotheses.push({ kind: 'move_line', from: base.position, to: last.position })
      if (peak > 1.01 && range(normal) < length * .02) {
        if (extrema.length === 1) hypotheses.push({ kind: 'overshoot', from: base.position, to: last.position, amountRatio: peak - 1, settleFraction: projection.indexOf(peak) / 64 })
        if (extrema.length > 1) for (const damping of [0, 2, 4, 6, 8, 10]) for (const cycles of [extrema.length / 2, (extrema.length + 1) / 2]) hypotheses.push({ kind: 'spring_settle', from: base.position, to: last.position, damping, cycles })
      }
      const ne = turns(normal)
      const nmin = Math.min(...normal); const nmax = Math.max(...normal)
      if (ne.length === 1 && (nmin > -.001 || nmax < .001)) hypotheses.push({ kind: 'move_arc', from: base.position, to: last.position, bendRatio: normal[32] / length })
      if (Math.abs(dy) < .001 && ne.length >= 1 && nmax < .001) {
        const count = Math.ceil(ne.length / 2)
        for (const decay of [1, .75, .5, .25]) hypotheses.push({ kind: 'bounce', from: base.position, to: last.position, heightRatio: -nmin, count, decay })
      }
      if (ne.length >= 2 && nmin < -.003 && nmax > .003) hypotheses.push({ kind: 'zigzag', from: base.position, to: last.position, amplitudeRatio: Math.max(-nmin, nmax), count: ne.length + 1 })
    } else {
      const axis: [number, number] = range(x) >= range(y) ? [1, 0] : [0, 1]
      const v = axis[0] ? x : y; const extrema = turns(v)
      if (extrema.length >= 2) hypotheses.push({ kind: 'sway', center: base.position, axis, amplitudeRatio: range(v) / 2, cycles: extrema.length / 2 })
    }
    if (!hypotheses.length && turns(x).length + turns(y).length >= 3 && spatial > .02) return { candidates: [{ kind: 'follow_path', intent: { kind: 'follow_path', preserveJitter: false }, distance: 0 }], rejected: false }
  }
  const normalization = [Math.max(.003, spatial), Math.max(.003, spatial), Math.max(.005, rotation), Math.max(.005, Math.log(Math.max(...s) / Math.min(...s))), Math.max(.005, Math.log(Math.max(...s) / Math.min(...s)))]
  const source = features(p, base, normalization)
  const ranked = hypotheses.map(intent => {
    const reference = features(p.map((_, i) => intentPose(intent, base, i / 64)), base, normalization)
    const distance = method === 'dtw' ? windowedFeatureDistance(source, reference, 6, control) : Math.sqrt(source.reduce((sum, v, i) => sum + v.reduce((sum, value, k) => sum + (value - reference[i][k]) ** 2, 0), 0) / source.length)
    return { kind: intent.kind, intent, distance }
  }).sort((a, b) => a.distance - b.distance)
  const candidates = ranked.filter((v, i) => !ranked.slice(0, i).some(w => w.kind === v.kind)).slice(0, 3)
  if (!candidates.length || candidates[0].distance > .15) {
    if (spatial > .02 && turns(x).length + turns(y).length >= 3 && rotation < .001 && scale < .001) return { candidates: [{ kind: 'follow_path', intent: { kind: 'follow_path', preserveJitter: false }, distance: 0 }], rejected: false }
    return reject('没有足够匹配证据，请保留示范路径')
  }
  if (candidates[1] && Math.abs(candidates[1].distance - candidates[0].distance) < .015) return { candidates, rejected: true, reason: '动作形状有歧义，请确认候选' }
  const result: PrimitiveRecognition = { candidates, rejected: false }
  const winner = candidates[0].intent
  if ((winner.kind === 'orbit' && Math.abs(winner.sweepTurns) >= 1.95) || winner.kind === 'sway' && winner.cycles >= 2) {
    const cycles = winner.kind === 'orbit' ? Math.abs(winner.sweepTurns) : winner.cycles
    const period = (take.points.at(-1)!.frame - take.points[0].frame) / cycles
    if (Math.abs(period - Math.round(period)) < .01) result.cycle = { kind: 'cycle', mode: 'loop', periodFrames: Math.round(period), template: winner.kind === 'orbit' ? { ...winner, sweepTurns: Math.sign(winner.sweepTurns) } : { ...winner, cycles: 1 } }
  }
  return result
}

/** A demonstrated out-and-back path, not a single travel, can suggest a finite pingpong. */
export function detectMotionCycle(take: PreparedTake): Extract<MotionIntent, { kind: 'cycle' }> | undefined {
  if (take.points.length < 5) return
  const recognized = recognizeMotionPrimitives(take)
  if (recognized.cycle) return recognized.cycle
  const poses = resample(take); const a = poses[0]; const b = poses[32]; const c = poses[64]
  const distance = Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1])
  const period = take.points.at(-1)!.frame - take.points[0].frame
  if (distance < .01 || period % 2 || Math.hypot(c.position[0] - a.position[0], c.position[1] - a.position[1]) > .0005) return
  if (poses.some((p, i) => {
    const projection = ((p.position[0] - a.position[0]) * (b.position[0] - a.position[0]) + (p.position[1] - a.position[1]) * (b.position[1] - a.position[1])) / (distance * distance)
    const error = Math.abs((p.position[0] - a.position[0]) * (b.position[1] - a.position[1]) - (p.position[1] - a.position[1]) * (b.position[0] - a.position[0])) / distance
    return projection < -.005 || projection > 1.005 || error > .0005 || Math.hypot(p.position[0] - poses[64 - i].position[0], p.position[1] - poses[64 - i].position[1]) > .0005 || p.rotationTurns !== a.rotationTurns || p.scaleXY.some((v, k) => v !== a.scaleXY[k])
  })) return
  return { kind: 'cycle', template: { kind: 'move_line', from: a.position, to: b.position }, mode: 'pingpong', periodFrames: period }
}
