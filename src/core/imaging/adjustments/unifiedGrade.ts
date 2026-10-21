import { COLOR_GRADE_CURVE_CHANNELS, COLOR_GRADE_HUE_CURVES, COLOR_GRADE_MIXER_CENTERS, COLOR_GRADE_MIXER_COLORS, COLOR_GRADE_WHEEL_REGIONS } from './colorGrade'
import { colorGradeCurvePoints, colorGradeSpline, parseColorGradeCurve } from './curves'
import { DISPLAY_HUE_ANCHORS, linearSrgbToOklab, linearToSrgb, MIDDLE_GRAY, oklabToLinearSrgb, srgbToLinear, whiteBalanceMatrix, type Vec3 } from './colorScience'

/**
 * Unified per-pixel color grade: every pointwise operation of one ColorGrade runs in one pass.
 * The parameters and curves are packed into a float table (row 0 parameters, rows 1–9 curves sampled at 256 points)
 * that the CPU reference below and the WGSL entry `color_grade_unified` read identically.
 *
 * Stage A (scene linear → perceptual luminance → OkLCh): white balance, exposure, contrast, tone zones, parametric curve,
 * saturation and vibrance. Stage B (encoded display values): faded film, color mixer, RGB curves, hue curves, color wheels.
 * A Look LUT sits between the two stages; without one both stages share a pass.
 */
/** 256 samples keep monotone splines within 1e-4 after linear interpolation; the table changes every drag frame, so it stays small. */
export const COLOR_GRADE_TABLE_WIDTH = 256
export const COLOR_GRADE_TABLE_ROWS = 1 + COLOR_GRADE_CURVE_CHANNELS.length + COLOR_GRADE_HUE_CURVES.length
/** Parameter slots (vec4) on row 0. Keep in sync with the WGSL reader. */
export const SLOT = { flags: 0, matrix: 1, tone: 4, tone2: 5, color: 6, wheel: 7, wheels: 8, mixer: 12, curveFlags: 22 } as const
export const PERCEPTUAL_MIDDLE_GRAY = linearToSrgb(MIDDLE_GRAY)

export interface ColorGradeTable { data: Float32Array; width: number; height: number; stageA: boolean; stageB: boolean; key: string }
type Params = Readonly<Record<string, unknown>>
const num = (params: Params, key: string, fallback = 0): number => { const value = params[key]; return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
const LUMA: Vec3 = [.2126, .7152, .0722]
const clamp = (x: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, x))
const smooth = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const fract = (x: number): number => x - Math.floor(x)
/** Luma-neutral rainbow tint shared with the HSL secondary wheel (WGSL `colorGradeTint`). */
export function colorGradeTintVector(hue: number): Vec3 {
  const rgb = [0, 2 / 3, 1 / 3].map(offset => clamp(Math.abs(fract(hue / 360 + offset) * 6 - 3) - 1)) as Vec3
  const y = rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2]
  return rgb.map(x => x - y) as Vec3
}

function fnv(data: Float32Array): string {
  const bytes = new Uint32Array(data.buffer, data.byteOffset, data.length); let hash = 2166136261
  for (let i = 0; i < bytes.length; i++) { hash ^= bytes[i]; hash = Math.imul(hash, 16777619) >>> 0 }
  return hash.toString(36)
}

/** Packs one ColorGrade parameter set; returns stage flags so planners skip neutral work entirely. */
export function buildColorGradeTable(params: Params, options: { key?: boolean } = {}): ColorGradeTable {
  const width = COLOR_GRADE_TABLE_WIDTH; const height = COLOR_GRADE_TABLE_ROWS
  const data = new Float32Array(width * height * 4)
  const slot = (index: number, values: readonly number[]): void => { data.set(values, index * 4) }
  const kelvin = num(params, 'temperature_kelvin', 6500); const tint = num(params, 'tint'); const exposure = num(params, 'exposure')
  const wb = whiteBalanceMatrix(kelvin, tint); const gain = 2 ** exposure
  const contrast = num(params, 'contrast') / 100
  const tone = ['highlights', 'shadows', 'whites', 'blacks', 'tone_highlights', 'tone_lights', 'tone_darks', 'tone_shadows'].map(key => num(params, key) / 100)
  const saturation = num(params, 'saturation') / 100; const vibrance = num(params, 'vibrance') / 100
  const matrixActive = kelvin !== 6500 || tint !== 0 || exposure !== 0
  const toneActive = contrast !== 0 || tone.some(Boolean)
  const colorActive = saturation !== 0 || vibrance !== 0
  const stageA = matrixActive || toneActive || colorActive
  for (let row = 0; row < 3; row++) slot(SLOT.matrix + row, [wb[row * 3] * gain, wb[row * 3 + 1] * gain, wb[row * 3 + 2] * gain, 0])
  slot(SLOT.tone, [contrast >= 0 ? 1 + contrast * 2 : 1 + contrast, tone[0], tone[1], tone[2]])
  slot(SLOT.tone2, [tone[3], tone[4], tone[5], tone[6]])
  slot(SLOT.color, [tone[7], saturation, vibrance, num(params, 'faded_film') / 100])

  const primary = params.wheel_mode === 'primary'
  let wheelsActive = false
  slot(SLOT.wheel, [primary ? 1 : 0, .1 + .8 * num(params, 'grade_blending', 50) / 100, .5 + .3 * num(params, 'grade_balance') / 100, 0])
  COLOR_GRADE_WHEEL_REGIONS.forEach((region, index) => {
    const strength = num(params, `${region}_strength`) / 100; const lum = num(params, `${region}_luminance`) / 100
    const tintVector = colorGradeTintVector(num(params, `${region}_hue`))
    if (strength || lum) wheelsActive = true
    // Grading adds a quarter of the vector (same scale as the original wheels); primary scales per operator in the shader.
    const scale = primary ? 1 : .25
    slot(SLOT.wheels + index, [...tintVector.map(x => (x * strength + lum) * scale), 0])
  })
  let mixerActive = false
  COLOR_GRADE_MIXER_COLORS.forEach((color, index) => {
    const values = ['hue', 'saturation', 'luminance'].map(channel => num(params, `mixer_${color}_${channel}`) / 100)
    if (values.some(Boolean)) mixerActive = true
    slot(SLOT.mixer + index, [values[0], values[1], values[2], COLOR_GRADE_MIXER_CENTERS[index]])
  })

  const curveFlags = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  COLOR_GRADE_CURVE_CHANNELS.forEach((channel, index) => {
    const points = colorGradeCurvePoints(params, channel)
    const row = 1 + index; const identity = points.every(point => point.y === point.x)
    curveFlags[index] = identity ? 0 : 1
    const evaluate = identity ? undefined : colorGradeSpline(points)
    for (let i = 0; i < width; i++) data[(row * width + i) * 4] = evaluate ? evaluate(i / (width - 1) * 100) / 100 : i / (width - 1)
  })
  COLOR_GRADE_HUE_CURVES.forEach((channel, index) => {
    const points = parseColorGradeCurve(params[`curve_${channel}_points`])
    const row = 1 + COLOR_GRADE_CURVE_CHANNELS.length + index; const identity = points.every(point => point.y === 50)
    curveFlags[4 + index] = identity ? 0 : 1
    const evaluate = identity ? undefined : colorGradeSpline(points)
    for (let i = 0; i < width; i++) data[(row * width + i) * 4] = evaluate ? evaluate(i / (width - 1) * 100) / 100 : .5
  })
  slot(SLOT.curveFlags, curveFlags.slice(0, 4)); slot(SLOT.curveFlags + 1, curveFlags.slice(4, 8)); slot(SLOT.curveFlags + 2, [curveFlags[8], 0, 0, 0])
  const stageB = num(params, 'faded_film') !== 0 || mixerActive || wheelsActive || curveFlags.some(Boolean)
  slot(SLOT.flags, [matrixActive ? 1 : 0, toneActive ? 1 : 0, colorActive ? 1 : 0, mixerActive ? 1 : 0])
  data[SLOT.wheel * 4 + 3] = wheelsActive ? 1 : 0
  return { data, width, height, stageA, stageB, key: options.key === false ? '' : fnv(data) }
}

// ---------- CPU reference (mirrors WGSL line for line) ----------
const p = (table: Float32Array, index: number): number[] => Array.from(table.subarray(index * 4, index * 4 + 4))
function curve(table: Float32Array, row: number, x: number): number {
  const at = clamp(x) * (COLOR_GRADE_TABLE_WIDTH - 1); const left = Math.floor(at); const right = Math.min(left + 1, COLOR_GRADE_TABLE_WIDTH - 1)
  const a = table[(row * COLOR_GRADE_TABLE_WIDTH + left) * 4]; const b = table[(row * COLOR_GRADE_TABLE_WIDTH + right) * 4]
  return a + (b - a) * (at - left)
}
const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
function knee(x: number, limit: number): number { const a = Math.abs(x); const k = .8 * limit; return Math.sign(x) * (a <= k ? a : limit - .2 * limit * Math.exp(-(a - k) / (.2 * limit))) }
/** Contrast around perceptual middle gray, soft-limited so a steep slope rolls into black/white instead of clipping. */
export function gradeContrast(perceptual: number, slope: number): number {
  if (slope === 1) return perceptual
  const p0 = PERCEPTUAL_MIDDLE_GRAY
  const toned = (x: number): number => { const d = (x - p0) * slope; return p0 + (slope > 1 ? knee(d, d > 0 ? 1 - p0 : p0) : d) }
  return perceptual > 1 ? toned(1) + (perceptual - 1) : toned(perceptual)
}
function bump(y: number, center: number): number { const d = Math.abs(y - center); return d >= .25 ? 0 : Math.cos(Math.PI * d / .5) ** 2 }
export function gradeTone(perceptual: number, tone: readonly number[], tone2: readonly number[], color: readonly number[]): number {
  const y = clamp(perceptual)
  const shadow = 1 - smooth(0, .5, y); const high = smooth(.5, 1, y)
  let value = perceptual + .25 * (tone[1] * high + tone[2] * shadow + tone[3] * y ** 4 + tone2[0] * (1 - y) ** 4)
  const envelope = Math.min(1, 4 * y) * Math.min(1, 4 * (1 - y))
  value += .15 * envelope * (tone2[1] * bump(y, .875) + tone2[2] * bump(y, .625) + tone2[3] * bump(y, .375) + color[0] * bump(y, .125))
  return value
}
function hueDistance(a: number, b: number): number { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }
function displayHue(anchors: readonly number[], hue: number): number {
  for (let i = 0; i < 6; i++) {
    const from = anchors[i]; const to = anchors[(i + 1) % 6] + (i === 5 ? 360 : 0); const h = hue < from ? hue + 360 : hue
    if (h >= from && h < to) return (i * 60 + (h - from) / (to - from) * 60) % 360
  }
  return 0
}
function oklabHueOf(anchors: readonly number[], display: number): number {
  const d = ((display % 360) + 360) % 360; const i = Math.min(5, Math.floor(d / 60))
  const from = anchors[i]; const to = anchors[(i + 1) % 6] + (i === 5 ? 360 : 0)
  return (from + (d - i * 60) / 60 * (to - from)) % 360
}
const encode = (rgb: readonly number[]): Vec3 => rgb.map(linearToSrgb) as Vec3
const decode = (rgb: readonly number[]): Vec3 => rgb.map(srgbToLinear) as Vec3

/** Slope of `gradeContrast` at a perceptual value: the old per-channel contrast scaled chroma by this amount. */
export function gradeContrastSlope(perceptual: number, slope: number): number {
  if (slope <= 1 || perceptual > 1) return slope > 1 ? 1 : slope
  const p0 = PERCEPTUAL_MIDDLE_GRAY; const d = (perceptual - p0) * slope; const limit = d > 0 ? 1 - p0 : p0; const k = .8 * limit
  return Math.abs(d) <= k ? slope : slope * Math.exp(-(Math.abs(d) - k) / (.2 * limit))
}

/** Stage A on straight encoded RGB. */
export function gradeStageA(rgb: Vec3, table: Float32Array): Vec3 {
  const flags = p(table, SLOT.flags)
  if (!flags[0] && !flags[1] && !flags[2]) return rgb
  let lin = decode(rgb)
  if (flags[0]) { const m = [p(table, SLOT.matrix), p(table, SLOT.matrix + 1), p(table, SLOT.matrix + 2)]; lin = [dot(m[0], lin), dot(m[1], lin), dot(m[2], lin)] }
  // Tone works on luminance and keeps the linear RGB ratios (hue). OkLab is homogeneous of degree 1/3 in linear light, so
  // scaling RGB by r scales L, a, b by ∛r: one forward/inverse pair covers tone, chroma follow and saturation.
  if (!flags[1] && !flags[2]) return encode(lin)
  const tone = p(table, SLOT.tone); const tone2 = p(table, SLOT.tone2); const color = p(table, SLOT.color)
  const lab = linearSrgbToOklab(lin)
  let lightness = lab[0]; let chromaScale = 1
  if (flags[1]) {
    const y = dot(lin, LUMA); const perceptual = linearToSrgb(Math.max(0, y))
    const graded = srgbToLinear(gradeTone(gradeContrast(perceptual, tone[0]), tone, tone2, color))
    chromaScale = gradeContrastSlope(perceptual, tone[0])
    lightness = y > 1e-6 ? lab[0] * Math.cbrt(graded / y) : linearSrgbToOklab(lin.map(x => x + graded - y))[0]
  }
  if (flags[2]) {
    const c = Math.hypot(lab[1], lab[2]) * chromaScale
    chromaScale *= Math.max(0, 1 + color[1])
    if (color[2] !== 0) {
      let skin = 1
      if (color[2] > 0 && c > 1e-6) { const h = Math.atan2(lab[2], lab[1]) * 180 / Math.PI; skin = 1 - .6 * Math.exp(-((hueDistance(h < 0 ? h + 360 : h, 55) / 22) ** 2)) }
      chromaScale *= Math.max(0, 1 + color[2] * (1 - smooth(0, .25, c)) * skin)
    }
  }
  lin = oklabToLinearSrgb([lightness, lab[1] * chromaScale, lab[2] * chromaScale])
  return encode(lin)
}

/** Stage B on straight encoded RGB. */
export function gradeStageB(rgb: Vec3, table: Float32Array): Vec3 {
  const flags = p(table, SLOT.flags); const color = p(table, SLOT.color); const wheel = p(table, SLOT.wheel)
  const curveFlags = [...p(table, SLOT.curveFlags), ...p(table, SLOT.curveFlags + 1), p(table, SLOT.curveFlags + 2)[0]]
  let e: Vec3 = rgb
  if (color[3]) e = e.map(x => x + (x * .75 + .125 - x) * color[3]) as Vec3
  if (curveFlags[0]) e = e.map(x => curve(table, 1, x)) as Vec3
  for (let channel = 0; channel < 3; channel++) if (curveFlags[1 + channel]) e[channel] = curve(table, 2 + channel, e[channel])
  // Color mixer and hue curves share one OkLCh round trip; every control reads the same input color (no order effects).
  if (flags[3] || curveFlags.slice(4).some(Boolean)) {
    const lab = linearSrgbToOklab(decode(e)); const c = Math.hypot(lab[1], lab[2])
    let hue = Math.atan2(lab[2], lab[1]) * 180 / Math.PI; if (hue < 0) hue += 360
    const dh = displayHue(DISPLAY_HUE_ANCHORS, hue)
    let shift = 0; let chromaScale = 1; let lightScale = 1
    if (flags[3]) {
      const weight = smooth(0, .06, c); let hueValue = 0; let sat = 0; let lum = 0
      for (let i = 0; i < 8; i++) {
        const slot = p(table, SLOT.mixer + i); const next = p(table, SLOT.mixer + (i + 1) % 8)
        const span = (next[3] - slot[3] + 360) % 360; const t = ((dh - slot[3] + 360) % 360) / span
        if (t >= 1) continue
        hueValue = (1 - t) * slot[0] + t * next[0]; sat = (1 - t) * slot[1] + t * next[1]; lum = (1 - t) * slot[2] + t * next[2]
        break
      }
      shift += hueValue * 30 * weight; chromaScale *= Math.max(0, 1 + sat * weight); lightScale *= 2 ** (.8 * lum * weight)
    }
    const weight = smooth(0, .04, c)
    const amount = (mode: number, x: number): number => curveFlags[4 + mode] ? (curve(table, 5 + mode, x) - .5) * 2 : 0
    const hueX = dh / 360
    chromaScale *= Math.max(0, 1 + amount(0, hueX) * weight) * Math.max(0, 1 + amount(3, clamp(lab[0]))) * Math.max(0, 1 + amount(4, clamp(c / .32)))
    shift += amount(1, hueX) * 180 * weight
    lightScale *= Math.max(0, 1 + amount(2, hueX) * .5 * weight)
    let ab = [lab[1] * chromaScale, lab[2] * chromaScale]
    if (shift !== 0 && c > 1e-6) { const h = oklabHueOf(DISPLAY_HUE_ANCHORS, dh + shift) * Math.PI / 180; ab = [c * chromaScale * Math.cos(h), c * chromaScale * Math.sin(h)] }
    e = encode(oklabToLinearSrgb([lab[0] * lightScale, ab[0], ab[1]]))
  }
  if (wheel[3]) {
    const regions = [0, 1, 2, 3].map(i => p(table, SLOT.wheels + i))
    if (wheel[0] > .5) {
      // Primary: Lift (shadows) / Gamma (midtones) / Gain (highlights) / Offset (global) on encoded values.
      e = e.map((x, c) => {
        let v = x * (1 + regions[2][c]) + .25 * regions[0][c] * (1 - x)
        v = Math.sign(v) * Math.abs(v) ** (2 ** -regions[1][c])
        return v + .25 * regions[3][c]
      }) as Vec3
    } else {
      const y = clamp(dot(e, LUMA)); const width = wheel[1]; const pivot = wheel[2]
      const shadow = 1 - smooth(pivot - width, pivot, y); const high = smooth(pivot, pivot + width, y); const mid = 1 - shadow - high
      e = e.map((x, c) => x + regions[0][c] * shadow + regions[1][c] * mid + regions[2][c] * high + regions[3][c]) as Vec3
    }
  }
  return e
}
