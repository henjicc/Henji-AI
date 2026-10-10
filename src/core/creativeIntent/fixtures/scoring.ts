import { evaluateVideoEditKeyframes } from '../../videoEdit/keyframes'
import { optimizeMotionDraft, type MotionCandidate } from '../candidates'
import { poseToNative } from '../motionCompiler'
import { prepareMotionTakes } from '../sampling'
import { recognizeMotionEvidence } from '../recognition'
import { scalarCurveExtremaTimes } from '../fitting'
import { type MotionFixture, fixtureMapping } from './motionFixtures'

export interface BenchmarkScore {
  id: string; score: number; hardFailures: string[]; maxPositionError: number; rms: number; p95: number; angleError: number; scaleError: number; focusDrift: number; eventOffsetFrames: number; eventF1: number | null; keyCount: number; candidates: number; elapsedMs: number; rmsImprovement: number | null
}
export const qualityScore = (ratio: number, budget: number): number => Math.max(0, 1 - .15 * ratio / budget)

/** Includes deliberate corruption tests: hard failures stay failures regardless of aggregate score. */
export function scoreMotionFixture(fixture: MotionFixture, candidateOverride?: MotionCandidate): BenchmarkScore {
  const before = JSON.stringify(fixture.input); const started = performance.now(); const result = optimizeMotionDraft(fixture.input); const elapsedMs = performance.now() - started
  const candidate = candidateOverride ?? result.candidates.find(c => c.id === 'intent') ?? result.candidates.find(c => c.id === (fixture.noisy ? 'clean' : 'faithful')) ?? result.candidates[0]
  const failures: string[] = []; const errors: number[] = []; let angle = 0; let scale = 0; let focusDrift = 0
  const motions = candidate?.motions[0]; const curves = motions?.curves ?? {}
  if (!candidate) failures.push('no-candidate')
  if (JSON.stringify(fixture.input) !== before) failures.push('raw-mutated')
  if (Object.keys(curves).some(k => !['x', 'y', 'scale', 'rotation'].includes(k))) failures.push('scope')
  for (const pin of fixture.input.draft.pins) {
    const sample = fixture.input.samples.find(s => s.sampleId === pin.sampleId)!
    const native = poseToNative(sample.pose, fixtureMapping); const frame = sample.timeline!.frame
    const properties = pin.properties.flatMap(p => p === 'position' ? ['x', 'y'] as const : p === 'scaleXY' ? ['scale'] as const : p === 'rotationTurns' ? ['rotation'] as const : ['anchorX', 'anchorY'] as const)
    for (const key of properties) if (evaluateVideoEditKeyframes(curves[key], frame, native[key]) !== native[key]) failures.push(`pin:${pin.id}:${key}`)
  }
  const fps = fixture.input.samples[0].timeline!.fps; const rate = fps.numerator / fps.denominator
  const end = fixture.input.samples[fixture.input.samples.length - 1].timeline!.frame
  const probeFrames = new Set(Object.values(curves).flatMap(c => scalarCurveExtremaTimes(c)))
  for (let frame = 0; frame <= end; frame += .25) probeFrames.add(frame)
  for (const frame of probeFrames) {
    const expected = fixture.reference(Math.min(fixture.duration, frame / rate)); const native = poseToNative(expected, fixtureMapping)
    const x = evaluateVideoEditKeyframes(curves.x, frame, native.x); const y = evaluateVideoEditKeyframes(curves.y, frame, native.y)
    errors.push(Math.hypot((x - native.x) * 3840 / 2160, y - native.y))
    angle = Math.max(angle, Math.abs(evaluateVideoEditKeyframes(curves.rotation, frame, native.rotation) - native.rotation))
    const s = evaluateVideoEditKeyframes(curves.scale, frame, native.scale)
    scale = Math.max(scale, Math.abs(Math.log(s / native.scale)))
    if (fixture.id === 'S08') {
      const base = fixture.reference(0); const fx = x + (.62 - base.position[0]) * s; const fy = y + (.41 - base.position[1]) * s
      focusDrift = Math.max(focusDrift, Math.hypot((fx - .62) * 3840 / 2160, fy - .41))
    }
  }
  errors.sort((a, b) => a - b); const maxPositionError = errors[errors.length - 1] ?? Infinity
  const rms = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / Math.max(1, errors.length)); const p95 = errors[Math.floor(errors.length * .95)] ?? Infinity
  const rawErrors = fixture.input.samples.map(s => (s.pose.position[0] - fixture.reference(s.timeline!.frame / rate).position[0]) * 3840 / 2160)
  const rawRms = Math.sqrt(rawErrors.reduce((s, e) => s + e * e, 0) / rawErrors.length)
  const rmsImprovement = fixture.noisy ? 1 - rms / rawRms : null
  const evidence = prepareMotionTakes(fixture.input.draft, fixture.input.samples).flatMap(recognizeMotionEvidence)
  const expectedEvidence = fixture.id === 'S02' || fixture.id === 'S10' ? [{ kind: 'dwell', frame: fixture.events[0].frame, end: fixture.events[1].frame }] : fixture.id === 'S03' ? [{ kind: 'overshoot', frame: fixture.events[0].frame, end: fixture.events[0].frame }] : []
  let eventOffsetFrames = 0
  const matches = expectedEvidence.filter(e => {
    const found = evidence.find(v => v.kind === e.kind)
    if (!found) { eventOffsetFrames = Infinity; return false }
    eventOffsetFrames = Math.max(eventOffsetFrames, Math.abs(found.frames[0] - e.frame), Math.abs(found.frames[1] - e.end)); return eventOffsetFrames <= 1
  }).length
  const eventF1 = expectedEvidence.length ? 2 * matches / (expectedEvidence.length + evidence.length) : null
  if (maxPositionError > (fixture.noisy ? .01 : .0005)) failures.push('geometry')
  if (focusDrift > .0005) failures.push('focus')
  if (angle > .25) failures.push('angle')
  if (scale > .005) failures.push('scale')
  if (eventOffsetFrames > 1 || eventF1 !== null && eventF1 < .9) failures.push('events')
  const valueX = (frame: number): number => evaluateVideoEditKeyframes(curves.x, frame, .15)
  if (fixture.id === 'S02' || fixture.id === 'S10') {
    const [start, finish] = fixture.events.map(e => e.frame)
    const expected = fixture.reference(start / rate).position[0]
    for (let f = start; f <= finish; f += .25) if (Math.abs(valueX(f) - expected) * 3840 / 2160 > .0005) { failures.push('dwell-drift'); break }
  }
  if (fixture.id === 'S03') {
    let peak = -Infinity; let peakFrame = 0
    for (let f = 0; f <= end; f += .25) if (valueX(f) > peak) { peak = valueX(f); peakFrame = f }
    if (Math.abs(peakFrame - fixture.events[0].frame) > 1 || Math.abs((peak - .75) / .048 - 1) > .05) failures.push('overshoot-peak')
  }
  if (fixture.id === 'S04') {
    const peaks: number[] = []
    for (let f = .25; f < end; f += .25) if (valueX(f) > valueX(f - .25) && valueX(f) >= valueX(f + .25) && valueX(f) > .75 + .0005) peaks.push(f)
    if (peaks.length !== 2 || Math.abs(peaks[0] / rate - .27) > 1 / rate || Math.abs(peaks[1] / rate - .75) > 1 / rate) failures.push('spring-peaks')
  }
  if (fixture.noisy && fixture.id === 'S01' && (rmsImprovement ?? 0) < .4) failures.push('cleanup')
  if (elapsedMs > 900) failures.push('compute-budget')
  const k = motions?.keyCount ?? 0; const complexity = fixture.kRange ? Math.min(1, fixture.kRange[1] / Math.max(1, k)) : null
  const quality = [qualityScore(maxPositionError, fixture.noisy ? .01 : .0005), qualityScore(angle, .25), qualityScore(scale, .005), qualityScore(focusDrift, .0005)]
  if (expectedEvidence.length) quality.push(qualityScore(eventOffsetFrames, 1))
  const entries: [number, number][] = [[25, quality.reduce((s, v) => s + v, 0) / quality.length], [15, qualityScore(elapsedMs, 900)]]
  if (eventF1 !== null) entries.push([35, eventF1])
  if (complexity !== null || rmsImprovement !== null) entries.push([15, ((complexity ?? 1) + (rmsImprovement === null ? 1 : Math.min(1, Math.max(0, rmsImprovement) / .4))) / 2])
  const score = 100 * entries.reduce((s, [w, q]) => s + w * q, 0) / entries.reduce((s, [w]) => s + w, 0)
  return { id: fixture.id, score, hardFailures: [...new Set(failures)], maxPositionError, rms, p95, angleError: angle, scaleError: scale, focusDrift, eventOffsetFrames, eventF1, keyCount: k, candidates: result.candidates.length, elapsedMs, rmsImprovement }
}
