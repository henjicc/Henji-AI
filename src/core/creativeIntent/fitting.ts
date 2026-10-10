import fitCurveUntyped from 'fit-curve'
import { evaluateVideoEditKeyframes, videoEditKeyframesSchema, type VideoEditKeyframe } from '../videoEdit/keyframes'
import { checkCancelled, type ComputationControl } from './sampling'

// 上游运行时支持第三个进度回调（用于取消），但自带声明漏了这个参数。
const fitCurve = fitCurveUntyped as (points: number[][], maxError: number, progressCallback?: () => void) => number[][][]

export interface ScalarSample { time: number; value: number; hard: boolean }
export interface FittedScalar { points: VideoEditKeyframe[]; maxError: number }

/** Analytic derivative roots locate probe times; values still use the existing evaluator. */
export function scalarCurveExtremaTimes(points: readonly VideoEditKeyframe[]): number[] {
  const times: number[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]; const b = points[i + 1]
    if (a.interpolation !== 'bezier' || !a.bezier) continue
    const [x1, y1, x2, y2] = a.bezier
    const qa = 3 * y1 - 3 * y2 + 1; const qb = 2 * (y2 - 2 * y1); const qc = y1
    const discriminant = qb * qb - 4 * qa * qc
    const roots = Math.abs(qa) < 1e-14 ? Math.abs(qb) < 1e-14 ? [] : [-qc / qb] : discriminant < 0 ? [] : [(-qb - Math.sqrt(discriminant)) / (2 * qa), (-qb + Math.sqrt(discriminant)) / (2 * qa)]
    const [start, end] = a.easeRange ?? [0, 1]
    for (const u of roots) if (u > 0 && u < 1) {
      const x = 3 * (1 - u) ** 2 * u * x1 + 3 * (1 - u) * u ** 2 * x2 + u ** 3
      if (x > start && x < end) times.push(a.time + (b.time - a.time) * (x - start) / (end - start))
    }
  }
  return times
}

/** Two free handles in a native fixed-time cubic basis, with endpoint equalities eliminated. */
function nativeCubic(samples: readonly ScalarSample[]): VideoEditKeyframe[] | null {
  if (samples.length < 4) return null
  const left = samples[0]; const right = samples[samples.length - 1]; const dv = right.value - left.value
  if (Math.abs(dv) < 1e-12) return null
  let aa = 0; let ab = 0; let bb = 0; let ar = 0; let br = 0
  for (const p of samples.slice(1, -1)) {
    const u = (p.time - left.time) / (right.time - left.time); const a = 3 * (1 - u) ** 2 * u; const b = 3 * (1 - u) * u * u
    const r = p.value - (1 - u) ** 3 * left.value - u ** 3 * right.value
    aa += a * a; ab += a * b; bb += b * b; ar += a * r; br += b * r
  }
  const det = aa * bb - ab * ab
  if (Math.abs(det) < 1e-14) return null
  const c1 = (ar * bb - br * ab) / det; const c2 = (br * aa - ar * ab) / det
  return [{ time: left.time, value: left.value, interpolation: 'bezier', bezier: [1 / 3, (c1 - left.value) / dv, 2 / 3, (c2 - left.value) / dv] }, { time: right.time, value: right.value, interpolation: 'linear' }]
}

function intentSamples(samples: readonly ScalarSample[], reference?: (time: number) => number): ScalarSample[] {
  if (!reference || samples.length < 2) return [...samples]
  const output: ScalarSample[] = []
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]; const b = samples[i + 1]
    for (let time = a.time; time < b.time; time += .25) output.push({ time, value: reference(time), hard: time === a.time && a.hard })
  }
  const last = samples[samples.length - 1]; output.push({ ...last, value: reference(last.time) }); return output
}
function subdivideNative(samples: readonly ScalarSample[], tolerance: number, control: ComputationControl, reference?: (time: number) => number): VideoEditKeyframe[] {
  const pending: [number, number][] = [[0, samples.length - 1]]; const output: VideoEditKeyframe[] = []
  while (pending.length) {
    checkCancelled(control)
    const [a, b] = pending.pop()!; const segment = samples.slice(a, b + 1); const probes = intentSamples(segment, reference); const fitted = nativeCubic(probes)
    if (fitted && scalarError(probes, fitted, false).maxError <= tolerance * .5) output.push(fitted[0])
    else if (b - a <= 2) output.push(...segment.slice(0, -1).map(p => ({ time: p.time, value: p.value, interpolation: 'linear' as const })))
    else { const middle = Math.floor((a + b) / 2); pending.push([middle, b], [a, middle]) }
  }
  output.push({ time: samples[samples.length - 1].time, value: samples[samples.length - 1].value, interpolation: 'linear' })
  return output
}

/** Schneider proposes scalar value/time Béziers. Pins/events split domains before it is called. */
export function fitScalarCurve(samples: readonly ScalarSample[], tolerance: number, control: ComputationControl = {}, reference?: (time: number) => number): FittedScalar {
  if (!samples.length) return { points: [], maxError: 0 }
  if (samples.length === 1) return { points: [{ time: samples[0].time, value: samples[0].value, interpolation: 'linear' }], maxError: 0 }
  const mandatory = new Set<number>([0, samples.length - 1])
  samples.forEach((s, i) => { if (s.hard) mandatory.add(i) })
  // A bounded library call is a work budget, not a product/sample limit.
  for (let i = 256; i < samples.length - 1; i += 256) mandatory.add(i)
  // Significant local extrema: prevents equal endpoints from becoming constants, without pinning noise.
  let direction = 0; let extreme = 0
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i].value - samples[extreme].value
    if (direction === 0 && Math.abs(d) > tolerance * 4) { direction = Math.sign(d); extreme = i }
    else if (direction * d >= 0) extreme = i
    else if (Math.abs(d) > tolerance * 4) { mandatory.add(extreme); direction *= -1; extreme = i }
  }
  const boundaries = [...mandatory].sort((a, b) => a - b); const result: VideoEditKeyframe[] = []
  for (let i = 1; i < boundaries.length; i++) {
    checkCancelled(control)
    const segment = samples.slice(boundaries[i - 1], boundaries[i] + 1)
    if (segment.every(p => p.value === segment[0].value)) {
      result.push({ time: segment[0].time, value: segment[0].value, interpolation: 'hold' }); continue
    }
    const start = segment[0].time; const span = segment[segment.length - 1].time - start
    // Schneider's chord parameter/tangents are geometric, not formal time constraints.
    // Refining the two scalar handles in the native basis avoids changing the recorded timing.
    const probes = intentSamples(segment, reference)
    const refined = nativeCubic(probes)
    if (refined && scalarError(probes, refined, false).maxError <= tolerance * .5) { result.push(refined[0]); continue }
    const proposals = fitCurve(segment.map(p => [(p.time - start) / span, p.value]), tolerance * tolerance * .04, () => checkCancelled(control))
    const native: VideoEditKeyframe[] = []
    let legal = true
    for (const c of proposals) {
      const a = c[0]; const b = c[3]; const dt = b[0] - a[0]; const dv = b[1] - a[1]
      const time = Math.round(start + a[0] * span); const end = Math.round(start + b[0] * span)
      const bezier: [number, number, number, number] = [(c[1][0] - a[0]) / dt, (c[1][1] - a[1]) / dv, (c[2][0] - a[0]) / dt, (c[2][1] - a[1]) / dv]
      if (end <= time || dt <= 0 || Math.abs(dv) < 1e-12 || !bezier.every(Number.isFinite) || bezier[0] < 0 || bezier[0] > 1 || bezier[2] < 0 || bezier[2] > 1) { legal = false; break }
      native.push({ time, value: a[1], interpolation: 'bezier', bezier })
    }
    native.push({ time: segment[segment.length - 1].time, value: segment[segment.length - 1].value, interpolation: 'linear' })
    const adaptive = subdivideNative(segment, tolerance, control, reference)
    if (legal && native.every((p, j) => j === 0 || p.time > native[j - 1].time) && scalarError(probes, native, false).maxError <= tolerance && native.length <= adaptive.length) {
      result.push(...native.slice(0, -1))
    } else {
      // Refine in the constrained native basis; dense legal frames remain the final fallback.
      result.push(...adaptive.slice(0, -1))
    }
  }
  result.push({ time: samples[samples.length - 1].time, value: samples[samples.length - 1].value, interpolation: 'linear' })
  // Very short bridges around a quantized turn need the surrounding time tangents, not chord tangents.
  // This changes no anchor value/time, and is disabled at holds or a zero value span.
  const original = result.map(p => ({ ...p }))
  const slope = (i: number, end: boolean): number => {
    const a = original[i]; const b = original[i + 1]; const secant = (Number(b.value) - Number(a.value)) / (b.time - a.time)
    if (a.interpolation === 'hold') return 0
    if (a.interpolation !== 'bezier' || !a.bezier) return secant
    const [x1, y1, x2, y2] = a.bezier
    return secant * (end ? (1 - y2) / Math.max(1e-8, 1 - x2) : y1 / Math.max(1e-8, x1))
  }
  result.forEach((a, i) => {
    const b = result[i + 1]
    if (reference || !b || i === 0 || i + 2 >= result.length || b.time - a.time > 2 || a.interpolation === 'hold' || original[i - 1].interpolation === 'hold' || original[i + 1].interpolation === 'hold') return
    const dv = Number(b.value) - Number(a.value); const dt = b.time - a.time
    if (Math.abs(dv) < 1e-12) return
    const leftSlope = slope(i - 1, true); const rightSlope = slope(i + 1, false)
    a.interpolation = 'bezier'; a.bezier = [1 / 3, leftSlope * dt / (3 * dv), 2 / 3, 1 - rightSlope * dt / (3 * dv)]
  })
  const points = videoEditKeyframesSchema.parse(result)
  return { points, maxError: scalarError(intentSamples(samples, reference), points, false).maxError }
}

/** Source samples define the intent between anchors; evaluation always uses the existing native evaluator. */
export function scalarError(samples: readonly ScalarSample[], points: readonly VideoEditKeyframe[], compareInteriors = true): { maxError: number; rms: number; p95: number } {
  const errors: number[] = []
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]; const b = samples[i + 1]
    const count = b && compareInteriors ? Math.max(4, Math.ceil((b.time - a.time) * 4)) : 1
    for (let j = 0; j < count; j++) {
      const u = b ? j / count : 0; const t = b ? a.time + (b.time - a.time) * u : a.time
      const value = b ? a.value + (b.value - a.value) * u : a.value
      errors.push(Math.abs(evaluateVideoEditKeyframes(points, t, value) - value))
    }
  }
  errors.sort((a, b) => a - b)
  return { maxError: errors[errors.length - 1] ?? 0, rms: Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / Math.max(1, errors.length)), p95: errors[Math.floor((errors.length - 1) * .95)] ?? 0 }
}

/** Median filter only for a requested cleanup family; event/pin neighborhoods stay exact. */
export function cleanScalarSamples(samples: readonly ScalarSample[], fidelity: number): ScalarSample[] {
  return samples.map((s, i) => {
    if (fidelity === 1 || s.hard || samples.slice(Math.max(0, i - 2), i + 3).some(p => p.hard)) return { ...s }
    const neighbors = samples.slice(Math.max(0, i - 2), i + 3).map(p => p.value).sort((a, b) => a - b)
    const median = neighbors[Math.floor(neighbors.length / 2)]
    return { ...s, value: s.value * fidelity + median * (1 - fidelity) }
  })
}
