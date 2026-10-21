import { linearSrgbToOklab, linearSrgbToXyz, luminance, MIDDLE_GRAY, srgbToLinear, TINT_DUV_PER_UNIT, xyToKelvinDuv, xyToUv, uvToXy, xyzToXy, illuminantXy, type Vec3 } from './colorScience'
import { buildColorGradeTable, gradeStageA, gradeStageB } from './unifiedGrade'
import { whiteBalanceFromGains } from './colorGradeMigration'
import { colorGradeDefaults } from './schema'

/**
 * Local automatic correction. Analysis runs on the ≤256 px frame; every result is expressed in the grade's own sliders
 * (temperature_kelvin, tint, exposure, whites/blacks…), never as a black-box LUT, so people and the assistant can read and
 * adjust it. Accuracy is tracked by `autoGradeEvaluation.ts` (ΔE2000 / EV against known casts).
 */
export interface AutoGradeOptions { scale?: number; width?: number }
export interface IlluminantVote { method: 'gray_world' | 'shades_of_gray' | 'gray_edge' | 'white_patch'; kelvin: number; duv: number }
export interface AutoGradeAnalysis { votes: IlluminantVote[]; kelvin: number; duv: number; confidence: number; strength: number; exposure: number; key: 'low' | 'normal' | 'high' }

/** Tuned on the evaluation set (0 → 0.2 EV lowered mean ΔE 7.36 → 6.90; 0.5 and above got worse). */
const EXPOSURE_DEAD_ZONE = .2
const clamp = (x: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, x))
const median = (values: number[]): number => { const sorted = [...values].sort((a, b) => a - b); const mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 }

interface Samples { linear: Float32Array; perceptual: Float32Array; peak: Float32Array; count: number; width: number }
function readSamples(pixels: ArrayLike<number>, scale: number, width: number): Samples {
  if (!pixels.length || pixels.length % 4 || !(scale > 0)) throw new Error('自动校色需要有效的 RGBA 画面。')
  const total = pixels.length / 4; const linear = new Float32Array(total * 3); const perceptual = new Float32Array(total); const peak = new Float32Array(total); let count = 0
  for (let i = 0; i < total; i++) {
    // Transparent pixels keep their slot (gray edge needs the grid) but are marked with a negative peak.
    const alpha = pixels[i * 4 + 3] / scale
    const encoded = [0, 1, 2].map(c => clamp(pixels[i * 4 + c] / scale))
    for (let c = 0; c < 3; c++) linear[i * 3 + c] = srgbToLinear(encoded[c])
    perceptual[i] = encoded[0] * .2126 + encoded[1] * .7152 + encoded[2] * .0722
    peak[i] = alpha < .5 ? -1 : Math.max(...encoded)
    if (alpha >= .5) count++
  }
  return { linear, perceptual, peak, count, width: width > 0 && total % width === 0 ? width : total }
}
function lightOf(sum: readonly number[]): { kelvin: number; duv: number } | undefined {
  return sum.every(x => x > 1e-9) ? xyToKelvinDuv(...xyzToXy(linearSrgbToXyz(sum))) : undefined
}

/** Four classic estimators (van de Weijer's framework): gray world, shades of gray p=6, first-order gray edge, white patch. */
export function voteIlluminant(samples: Samples): IlluminantVote[] {
  const { linear, peak, width } = samples; const total = peak.length
  const usable = (i: number): boolean => peak[i] > .03 && peak[i] < .97
  const gray = [0, 0, 0]; const shades = [0, 0, 0]; const edge = [0, 0, 0]; let grayCount = 0; let shadesCount = 0; let edgeCount = 0
  for (let i = 0; i < total; i++) {
    if (!usable(i)) continue
    const r = linear[i * 3]; const g = linear[i * 3 + 1]; const b = linear[i * 3 + 2]; const hi = Math.max(r, g, b); const lo = Math.min(r, g, b)
    // Gray world over low-saturation candidates (OpenCV GrayworldWB style rejection keeps vivid objects out).
    if (hi > 0 && (hi - lo) / hi < .9) { gray[0] += r; gray[1] += g; gray[2] += b; grayCount++ }
    shades[0] += r ** 6; shades[1] += g ** 6; shades[2] += b ** 6; shadesCount++
    const x = i % width; const y = Math.floor(i / width)
    if (x + 1 < width && y + 1 < total / width) {
      const right = i + 1; const down = i + width
      if (usable(right) && usable(down)) {
        for (let c = 0; c < 3; c++) edge[c] += Math.hypot(linear[right * 3 + c] - linear[i * 3 + c], linear[down * 3 + c] - linear[i * 3 + c])
        edgeCount++
      }
    }
  }
  // White patch: mean of the brightest 2% that is not clipped.
  const order = Array.from({ length: total }, (_, i) => i).filter(usable).sort((a, b) => samples.perceptual[b] - samples.perceptual[a])
  const top = order.slice(0, Math.max(8, Math.floor(order.length * .02))); const white = [0, 0, 0]
  for (const i of top) for (let c = 0; c < 3; c++) white[c] += linear[i * 3 + c]
  const votes: IlluminantVote[] = []
  const push = (method: IlluminantVote['method'], sum: number[], enough: boolean): void => { const light = enough ? lightOf(sum) : undefined; if (light) votes.push({ method, kelvin: light.kelvin, duv: light.duv }) }
  push('gray_world', gray, grayCount >= 16)
  push('shades_of_gray', shades.map(v => v ** (1 / 6)), shadesCount >= 16)
  push('gray_edge', edge, edgeCount >= 16)
  push('white_patch', white, top.length >= 8)
  return votes
}

/** Median vote in CIE 1960 uv; confidence from the spread of the votes. Low confidence (likely an intended cast) corrects only partly. */
export function combineIlluminantVotes(votes: readonly IlluminantVote[]): { kelvin: number; duv: number; confidence: number; strength: number } {
  if (!votes.length) return { kelvin: 6500, duv: 0, confidence: 0, strength: 0 }
  const uv = votes.map(vote => xyToUv(...illuminantXy(vote.kelvin, vote.duv)))
  const center: [number, number] = [median(uv.map(p => p[0])), median(uv.map(p => p[1]))]
  const spread = median(uv.map(p => Math.hypot(p[0] - center[0], p[1] - center[1])))
  const light = xyToKelvinDuv(...uvToXy(...center))
  // Estimators disagree by ~0.01 uv on ordinary scenes; 0.015 means they no longer describe one light.
  const confidence = clamp(1 - spread / .015) * clamp(votes.length / 3)
  const strength = .4 + .6 * confidence
  return { kelvin: light.kelvin, duv: light.duv, confidence, strength }
}
/** Pull the estimated light towards the 6500 K reference in mired/Duv when only a partial correction is wanted. */
function partial(kelvin: number, duv: number, strength: number): { kelvin: number; duv: number } {
  const mired = 1e6 / 6500 + (1e6 / kelvin - 1e6 / 6500) * strength
  return { kelvin: 1e6 / mired, duv: duv * strength }
}

/** Exposure from the log-average key, keeping intentional low/high key scenes and protecting the brightest unclipped values. */
export function estimateExposure(samples: Samples, gains: Vec3): { exposure: number; key: 'low' | 'normal' | 'high' } {
  const values: number[] = []; let logSum = 0
  for (let i = 0; i < samples.peak.length; i++) {
    if (samples.peak[i] < 0) continue
    const y = luminance([samples.linear[i * 3] * gains[0], samples.linear[i * 3 + 1] * gains[1], samples.linear[i * 3 + 2] * gains[2]])
    values.push(y); logSum += Math.log(Math.max(1e-4, y))
  }
  if (values.length < 8) return { exposure: 0, key: 'normal' }
  values.sort((a, b) => a - b)
  const q = (p: number): number => values[Math.min(values.length - 1, Math.floor(p * (values.length - 1)))]
  const logAverage = Math.exp(logSum / values.length); const p50 = q(.5); const p90 = q(.9); const p10 = q(.1)
  const key: 'low' | 'normal' | 'high' = p50 < .03 && p90 < .2 ? 'low' : p50 > .45 && p10 > .2 ? 'high' : 'normal'
  // Reinhard key: normal scenes aim the log average at middle gray; low/high key scenes keep most of their mood.
  const target = key === 'low' ? Math.max(logAverage, Math.min(MIDDLE_GRAY, logAverage * 1.6)) : key === 'high' ? Math.min(logAverage, Math.max(MIDDLE_GRAY * 2.5, logAverage * .8)) : MIDDLE_GRAY
  let exposure = Math.log2(target / Math.max(1e-6, logAverage))
  // Scene content legitimately sits a little off middle gray: leave small offsets alone, correct only the excess.
  exposure = Math.sign(exposure) * Math.max(0, Math.abs(exposure) - EXPOSURE_DEAD_ZONE)
  // Highlight protection: the 99.5th percentile must not be pushed past white by the gain.
  const ceiling = q(.995)
  if (ceiling > 0 && ceiling < .98) exposure = Math.min(exposure, Math.log2(.98 / ceiling))
  return { exposure: clamp(exposure, -3, 3), key }
}

export function analyzeAutoGrade(pixels: ArrayLike<number>, options: AutoGradeOptions = {}): AutoGradeAnalysis {
  const samples = readSamples(pixels, options.scale ?? 255, options.width ?? 0)
  if (samples.count < 16) throw new Error('画面几乎全透明，无法自动校色。')
  const votes = voteIlluminant(samples)
  const combined = combineIlluminantVotes(votes)
  const light = partial(combined.kelvin, combined.duv, combined.strength)
  // The white balance correction preserves the luminance of neutral surfaces, so exposure is measured on the input directly.
  const gains: Vec3 = [1, 1, 1]
  const { exposure, key } = estimateExposure(samples, gains)
  return { votes, kelvin: light.kelvin, duv: light.duv, confidence: combined.confidence, strength: combined.strength, exposure, key }
}

/** Slider suggestions; absolute values that replace the basic-correction sliders (not deltas). */
export function suggestColorGradeAutoColor(pixels: ArrayLike<number>, scale = 255, width = 0): Record<string, number> { return suggestAutoGrade(pixels, { scale, width }) }
export function suggestAutoGrade(pixels: ArrayLike<number>, options: AutoGradeOptions = {}): Record<string, number> {
  const analysis = analyzeAutoGrade(pixels, options)
  return {
    temperature_kelvin: Math.round(clamp(analysis.kelvin, 2000, 20000) * 10) / 10,
    tint: Math.round(clamp(analysis.duv / TINT_DUV_PER_UNIT, -100, 100) * 100) / 100,
    exposure: Math.round(analysis.exposure * 100) / 100,
  }
}

// ---------- Shot matching: MKL in OkLab, then fit back to sliders ----------
type M3 = number[][]
const mul = (a: M3, b: M3): M3 => a.map(row => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)))
const transpose = (a: M3): M3 => a[0].map((_, j) => a.map(row => row[j]))
/** Jacobi eigen-decomposition of a symmetric 3×3 matrix. */
function eigen(m: M3): { values: number[]; vectors: M3 } {
  const a = m.map(row => [...row]); const v: M3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0; for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] ** 2
    if (off < 1e-20) break
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-14) continue
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]); const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1)); const c = 1 / Math.sqrt(t * t + 1); const s = t * c
      for (let k = 0; k < 3; k++) { const akp = a[k][p]; const akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq }
      for (let k = 0; k < 3; k++) { const apk = a[p][k]; const aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p]; const vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: v }
}
function symmetricPower(m: M3, power: number): M3 {
  const { values, vectors } = eigen(m)
  const d = values.map(value => Math.max(1e-10, value) ** power)
  return mul(mul(vectors, [[d[0], 0, 0], [0, d[1], 0], [0, 0, d[2]]]), transpose(vectors))
}
interface Moments { mean: number[]; covariance: M3; samples: Vec3[] }
function oklabMoments(pixels: ArrayLike<number>, scale: number, limit = 4096): Moments {
  const total = pixels.length / 4; const step = Math.max(1, Math.floor(total / limit)); const samples: Vec3[] = []
  for (let i = 0; i < total; i += step) {
    if (pixels[i * 4 + 3] / scale < .5) continue
    samples.push(linearSrgbToOklab([0, 1, 2].map(c => srgbToLinear(clamp(pixels[i * 4 + c] / scale)))))
  }
  if (samples.length < 16) throw new Error('匹配需要更多可见画面，请选择其他参考片段。')
  const mean = [0, 1, 2].map(c => samples.reduce((sum, s) => sum + s[c], 0) / samples.length)
  const covariance: M3 = [0, 1, 2].map(r => [0, 1, 2].map(c => samples.reduce((sum, s) => sum + (s[r] - mean[r]) * (s[c] - mean[c]), 0) / samples.length + (r === c ? 1e-6 : 0)))
  return { mean, covariance, samples }
}
/** Pitié & Kokaram (2007) linear Monge–Kantorovich transfer: T = Σs^-½ (Σs^½ Σr Σs^½)^½ Σs^-½. */
export function mklTransfer(source: Moments, reference: Moments): (lab: Vec3) => Vec3 {
  const half = symmetricPower(source.covariance, .5); const inverseHalf = symmetricPower(source.covariance, -.5)
  const t = mul(mul(inverseHalf, symmetricPower(mul(mul(half, reference.covariance), half), .5)), inverseHalf)
  return lab => [0, 1, 2].map(r => reference.mean[r] + t[r].reduce((sum, value, k) => sum + value * (lab[k] - source.mean[k]), 0)) as Vec3
}

const FIT_KEYS = ['temperature_kelvin', 'tint', 'exposure', 'contrast', 'saturation', 'highlights', 'shadows'] as const
const FIT_SCALE: Record<typeof FIT_KEYS[number], number> = { temperature_kelvin: 1500, tint: 25, exposure: .7, contrast: 30, saturation: 30, highlights: 30, shadows: 30 }
const FIT_LIMIT: Record<typeof FIT_KEYS[number], [number, number]> = { temperature_kelvin: [2000, 20000], tint: [-100, 100], exposure: [-4, 4], contrast: [-100, 100], saturation: [-100, 100], highlights: [-100, 100], shadows: [-100, 100] }
/**
 * Parameter back-fitting: Nelder–Mead over the basic sliders so the production grade (CPU reference) reproduces the target
 * colors on a small sample. Any target — MKL match, a model output or a LUT — becomes editable sliders.
 */
export function fitGradeParameters(sources: readonly Vec3[], targets: readonly Vec3[], start: Record<string, number> = {}): { params: Record<string, number>; error: number } {
  const encodedSources = sources.map(lab => lab)
  const base = colorGradeDefaults()
  const decode = (x: number[]): Record<string, number> => Object.fromEntries(FIT_KEYS.map((key, i) => [key, clamp(Number(base[key]) + x[i] * FIT_SCALE[key], ...FIT_LIMIT[key])]))
  const cost = (x: number[]): number => {
    const table = buildColorGradeTable({ ...base, ...decode(x) }, { key: false }).data
    let sum = 0
    for (let i = 0; i < encodedSources.length; i++) {
      const graded = gradeStageB(gradeStageA(encodedSources[i], table), table).map(v => srgbToLinear(clamp(v))) as Vec3
      const lab = linearSrgbToOklab(graded); const target = targets[i]
      sum += (lab[0] - target[0]) ** 2 + (lab[1] - target[1]) ** 2 + (lab[2] - target[2]) ** 2
    }
    return sum / encodedSources.length
  }
  const n = FIT_KEYS.length
  const x0 = FIT_KEYS.map(key => ((start[key] ?? Number(base[key])) - Number(base[key])) / FIT_SCALE[key])
  let simplex = [x0, ...FIT_KEYS.map((_, i) => x0.map((v, j) => j === i ? v + .25 : v))].map(point => ({ point, value: cost(point) }))
  for (let iteration = 0; iteration < 120; iteration++) {
    simplex.sort((a, b) => a.value - b.value)
    if (simplex[n].value - simplex[0].value < 1e-9) break
    const centroid = Array.from({ length: n }, (_, j) => simplex.slice(0, n).reduce((sum, s) => sum + s.point[j], 0) / n)
    const worst = simplex[n]
    const at = (t: number): { point: number[]; value: number } => { const point = centroid.map((c, j) => c + t * (worst.point[j] - c)); return { point, value: cost(point) } }
    const reflected = at(-1)
    if (reflected.value < simplex[0].value) { const expanded = at(-2); simplex[n] = expanded.value < reflected.value ? expanded : reflected; continue }
    if (reflected.value < simplex[n - 1].value) { simplex[n] = reflected; continue }
    const contracted = at(reflected.value < worst.value ? -.5 : .5)
    if (contracted.value < Math.min(worst.value, reflected.value)) { simplex[n] = contracted; continue }
    simplex = simplex.map((s, i) => i === 0 ? s : (() => { const point = s.point.map((v, j) => simplex[0].point[j] + .5 * (v - simplex[0].point[j])); return { point, value: cost(point) } })())
  }
  simplex.sort((a, b) => a.value - b.value)
  const params = decode(simplex[0].point)
  return { params: Object.fromEntries(Object.entries(params).map(([key, value]) => [key, Math.round(value * 100) / 100])), error: Math.sqrt(simplex[0].value) }
}

/** Shot match: MKL in OkLab gives the target colors; back-fitting turns them into slider values (editable, no hidden LUT). */
export function suggestColorGradeMklMatch(source: ArrayLike<number>, reference: ArrayLike<number>, scale = 255): Record<string, number | string | boolean> {
  const from = oklabMoments(source, scale); const to = oklabMoments(reference, scale)
  const transfer = mklTransfer(from, to)
  // One sample per occupied OkLab cell: rare colors (skin, foliage, a chart patch) weigh as much as the dominant backdrop.
  const cells = new Map<string, Vec3>()
  for (const lab of from.samples) { const key = `${Math.round(lab[0] * 12)}:${Math.round(lab[1] * 24)}:${Math.round(lab[2] * 24)}`; if (!cells.has(key)) cells.set(key, lab) }
  const all = [...cells.values()]; const stride = Math.max(1, Math.ceil(all.length / 192))
  const picked = all.filter((_, i) => i % stride === 0)
  const sources = picked.map(lab => linearToEncoded(lab))
  const targets = picked.map(transfer)
  const { params } = fitGradeParameters(sources, targets, initialMatchGuess(picked, targets))
  // Matching starts from a neutral grade so applying it does not grade twice.
  return { ...colorGradeDefaults(), ...params }
}
/** Closed-form starting point: white balance from the mean gains, exposure from mean luminance, contrast/saturation from spreads. */
function initialMatchGuess(sources: readonly Vec3[], targets: readonly Vec3[]): Record<string, number> {
  const mean = (values: readonly Vec3[]): Vec3 => [0, 1, 2].map(c => values.reduce((sum, v) => sum + v[c], 0) / values.length) as Vec3
  const linear = (values: readonly Vec3[]): Vec3 => mean(values.map(lab => oklabToLinear(lab).map(x => Math.max(1e-5, x)) as Vec3))
  const ms = linear(sources); const mt = linear(targets)
  const gains = [0, 1, 2].map(c => mt[c] / ms[c]) as Vec3
  const wb = whiteBalanceFromGains(gains)
  const exposure = Math.log2(luminance(mt) / Math.max(1e-6, luminance(ms)))
  const deviation = (values: readonly Vec3[], pick: (v: Vec3) => number): number => { const m = values.reduce((sum, v) => sum + pick(v), 0) / values.length; return Math.sqrt(values.reduce((sum, v) => sum + (pick(v) - m) ** 2, 0) / values.length) }
  const slope = deviation(targets, v => v[0]) / Math.max(1e-4, deviation(sources, v => v[0]))
  const chroma = (values: readonly Vec3[]): number => values.reduce((sum, v) => sum + Math.hypot(v[1], v[2]), 0) / values.length
  const saturation = (chroma(targets) / Math.max(1e-4, chroma(sources)) / Math.max(.25, slope) - 1) * 100
  return { temperature_kelvin: wb.temperature_kelvin, tint: wb.tint, exposure: clamp(exposure, -4, 4), contrast: clamp(slope >= 1 ? (slope - 1) * 50 : (slope - 1) * 100, -100, 100), saturation: clamp(saturation, -100, 100) }
}
function linearToEncoded(lab: Vec3): Vec3 {
  const rgb = oklabToLinear(lab)
  return rgb.map(x => { const a = Math.max(0, x); return a <= .0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - .055 }) as Vec3
}
function oklabToLinear(lab: Vec3): Vec3 {
  const l = (lab[0] + .3963377774 * lab[1] + .2158037573 * lab[2]) ** 3
  const m = (lab[0] - .1055613458 * lab[1] - .0638541728 * lab[2]) ** 3
  const s = (lab[0] - .0894841775 * lab[1] - 1.291485548 * lab[2]) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s]
}
