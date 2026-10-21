/**
 * Color science shared by grading, statistics, automatic correction and evaluation.
 * Linear values are scene-referred linear sRGB (Rec.709 primaries, D65); every function is pure.
 */
export type Vec3 = [number, number, number]
export type Mat3 = [number, number, number, number, number, number, number, number, number]

export const REC709_LUMA: Vec3 = [.2126, .7152, .0722]
export const MIDDLE_GRAY = .18
const SRGB_TO_XYZ: Mat3 = [.4124564, .3575761, .1804375, .2126729, .7151522, .072175, .0193339, .119192, .9503041]
/** White of the sRGB matrix itself, so RGB grey and the D65 reference coincide exactly (≈ 0.3127, 0.3290). */
export const D65_XY: readonly [number, number] = ((): [number, number] => { const x = SRGB_TO_XYZ[0] + SRGB_TO_XYZ[1] + SRGB_TO_XYZ[2]; const y = SRGB_TO_XYZ[3] + SRGB_TO_XYZ[4] + SRGB_TO_XYZ[5]; const z = SRGB_TO_XYZ[6] + SRGB_TO_XYZ[7] + SRGB_TO_XYZ[8]; return [x / (x + y + z), y / (x + y + z)] })()
const XYZ_TO_SRGB: Mat3 = [3.2404542, -1.5371385, -.4985314, -.969266, 1.8760108, .041556, .0556434, -.2040259, 1.0572252]
/** CIECAM16 adaptation space (Li et al. 2017); better conditioned than Bradford for out-of-gamut colors. */
export const CAT16: Mat3 = [.401288, .650173, -.051461, -.250268, 1.204414, .045854, -.002079, .048952, .953127]

export const srgbToLinear = (x: number): number => { const a = Math.abs(x); return Math.sign(x) * (a <= .04045 ? a / 12.92 : ((a + .055) / 1.055) ** 2.4) }
export const linearToSrgb = (x: number): number => { const a = Math.abs(x); return Math.sign(x) * (a <= .0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - .055) }
export const luminance = (rgb: readonly number[]): number => rgb[0] * REC709_LUMA[0] + rgb[1] * REC709_LUMA[1] + rgb[2] * REC709_LUMA[2]

export function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9) as Mat3
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
  return r
}
export function applyMat3(m: Mat3, v: readonly number[]): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]
}
export function invertMat3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h; const B = -(d * i - f * g); const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('颜色矩阵不可逆。')
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
}
export const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export const linearSrgbToXyz = (rgb: readonly number[]): Vec3 => applyMat3(SRGB_TO_XYZ, rgb)
export const xyzToLinearSrgb = (xyz: readonly number[]): Vec3 => applyMat3(XYZ_TO_SRGB, xyz)
export const xyToXyz = (x: number, y: number, Y = 1): Vec3 => [x * Y / y, Y, (1 - x - y) * Y / y]
export function xyzToXy(xyz: readonly number[]): [number, number] { const sum = xyz[0] + xyz[1] + xyz[2]; return sum > 0 ? [xyz[0] / sum, xyz[1] / sum] : [...D65_XY] }

// ---- CIE 1960 UCS, Planckian locus, correlated color temperature ----
export const xyToUv = (x: number, y: number): [number, number] => { const d = -2 * x + 12 * y + 3; return [4 * x / d, 6 * y / d] }
export const uvToXy = (u: number, v: number): [number, number] => { const d = 2 * u - 8 * v + 4; return [3 * u / d, 2 * v / d] }
/** Kim et al. (2002) cubic fit of the Planckian locus, 1667–25000 K. */
export function planckianXy(kelvin: number): [number, number] {
  const t = Math.min(25000, Math.max(1667, kelvin))
  const x = t <= 4000 ? -.2661239e9 / t ** 3 - .2343589e6 / t ** 2 + .8776956e3 / t + .17991 : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + .2226347e3 / t + .24039
  const y = t <= 2222 ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - .20219683
    : t <= 4000 ? -.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - .16748867
      : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - .37001483
  return [x, y]
}
function planckianUvFrame(kelvin: number): { uv: [number, number]; normal: [number, number] } {
  const uv = xyToUv(...planckianXy(kelvin)); const next = xyToUv(...planckianXy(kelvin * 1.001))
  const du = next[0] - uv[0]; const dv = next[1] - uv[1]; const length = Math.hypot(du, dv) || 1
  // Positive Duv lies above the locus (towards green); rotate the tangent (pointing to higher K, decreasing u) accordingly.
  const normal: [number, number] = [-dv / length, du / length]
  return { uv, normal: normal[1] >= 0 ? normal : [-normal[0], -normal[1]] }
}
export const REFERENCE_WHITE_KELVIN = 6500
/** Planckian 6500 K is shifted onto D65 exactly so that the neutral slider position is an identity. */
const D65_OFFSET = ((): [number, number] => { const d65 = xyToUv(...D65_XY); const p = planckianUvFrame(REFERENCE_WHITE_KELVIN).uv; return [d65[0] - p[0], d65[1] - p[1]] })()
/** Illuminant chromaticity for a color temperature and Duv offset (positive Duv = greener light). */
export function illuminantXy(kelvin: number, duv = 0): [number, number] {
  const { uv, normal } = planckianUvFrame(kelvin)
  return uvToXy(uv[0] + normal[0] * duv + D65_OFFSET[0], uv[1] + normal[1] * duv + D65_OFFSET[1])
}
/** Inverse of `illuminantXy`: robust bisection on the locus followed by the signed perpendicular distance. */
export function xyToKelvinDuv(x: number, y: number): { kelvin: number; duv: number } {
  const [u0, v0] = xyToUv(x, y); const target: [number, number] = [u0 - D65_OFFSET[0], v0 - D65_OFFSET[1]]
  const distance = (kelvin: number): number => { const { uv, normal } = planckianUvFrame(kelvin); const du = target[0] - uv[0]; const dv = target[1] - uv[1]; return du * -normal[1] + dv * normal[0] }
  // Signed along-tangent residual changes sign at the foot of the perpendicular; search in mired for uniform spacing.
  let lo = 1e6 / 1700; let hi = 1e6 / 25000
  let fLo = distance(1e6 / lo)
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2; const fMid = distance(1e6 / mid)
    if (Math.sign(fMid) === Math.sign(fLo)) { lo = mid; fLo = fMid } else hi = mid
  }
  const kelvin = 1e6 / ((lo + hi) / 2); const { uv, normal } = planckianUvFrame(kelvin)
  return { kelvin, duv: (target[0] - uv[0]) * normal[0] + (target[1] - uv[1]) * normal[1] }
}

/** Von Kries adaptation in CAT16 space, expressed as one linear sRGB matrix (source white → destination white). */
export function chromaticAdaptationMatrix(sourceXy: readonly [number, number], destinationXy: readonly [number, number]): Mat3 {
  const source = applyMat3(CAT16, xyToXyz(sourceXy[0], sourceXy[1])); const destination = applyMat3(CAT16, xyToXyz(destinationXy[0], destinationXy[1]))
  const scale: Mat3 = [destination[0] / source[0], 0, 0, 0, destination[1] / source[1], 0, 0, 0, destination[2] / source[2]]
  return mulMat3(XYZ_TO_SRGB, mulMat3(invertMat3(CAT16), mulMat3(scale, mulMat3(CAT16, SRGB_TO_XYZ))))
}
/** Tint slider ±100 ↔ illuminant Duv ±0.03: positive tint corrects a green (positive Duv) cast, rendering more magenta. */
export const TINT_DUV_PER_UNIT = .0003
/**
 * White balance as a correction: the slider names the light the picture was lit by.
 * Below the 6500 K reference the result turns cooler, above it warmer; luminance of neutral greys is preserved.
 */
export function whiteBalanceMatrix(kelvin: number, tint: number): Mat3 {
  if (kelvin === REFERENCE_WHITE_KELVIN && tint === 0) return IDENTITY_MAT3
  const m = chromaticAdaptationMatrix(illuminantXy(kelvin, tint * TINT_DUV_PER_UNIT), D65_XY)
  // Keep the exposure of a neutral surface: normalize so the adapted source white keeps its luminance.
  const white = xyzToLinearSrgb(xyToXyz(...illuminantXy(kelvin, tint * TINT_DUV_PER_UNIT)))
  const scale = luminance(white) / Math.max(1e-9, luminance(applyMat3(m, white)))
  return m.map(value => value * scale) as Mat3
}

// ---- OkLab / OkLCh (Ottosson 2020) ----
const cbrt = (x: number): number => Math.sign(x) * Math.abs(x) ** (1 / 3)
export function linearSrgbToOklab(rgb: readonly number[]): Vec3 {
  const l = cbrt(.4122214708 * rgb[0] + .5363325363 * rgb[1] + .0514459929 * rgb[2])
  const m = cbrt(.2119034982 * rgb[0] + .6806995451 * rgb[1] + .1073969566 * rgb[2])
  const s = cbrt(.0883024619 * rgb[0] + .2817188376 * rgb[1] + .6299787005 * rgb[2])
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s]
}
export function oklabToLinearSrgb(lab: readonly number[]): Vec3 {
  const l = (lab[0] + .3963377774 * lab[1] + .2158037573 * lab[2]) ** 3
  const m = (lab[0] - .1055613458 * lab[1] - .0638541728 * lab[2]) ** 3
  const s = (lab[0] - .0894841775 * lab[1] - 1.291485548 * lab[2]) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s]
}
/** OkLCh hue in degrees [0, 360). */
export const oklabHue = (lab: readonly number[]): number => { const h = Math.atan2(lab[2], lab[1]) * 180 / Math.PI; return h < 0 ? h + 360 : h }

/**
 * "Display hue": OkLCh hue re-scaled piecewise so the six sRGB primaries/secondaries land on the familiar HSL wheel
 * (red 0, yellow 60, green 120, cyan 180, blue 240, magenta 300). Hue controls keep the old axis while measuring perceptually.
 */
export const DISPLAY_HUE_ANCHORS: readonly number[] = [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [1, 0, 1]].map(rgb => oklabHue(linearSrgbToOklab(rgb)))
export function oklabHueToDisplayHue(hue: number): number {
  const a = DISPLAY_HUE_ANCHORS
  for (let i = 0; i < 6; i++) {
    const from = a[i]; const to = a[(i + 1) % 6] + (i === 5 ? 360 : 0)
    const h = hue < from ? hue + 360 : hue
    if (h >= from && h < to) return (i * 60 + (h - from) / (to - from) * 60) % 360
  }
  return 0
}
export function displayHueToOklabHue(display: number): number {
  const d = ((display % 360) + 360) % 360; const i = Math.min(5, Math.floor(d / 60)); const a = DISPLAY_HUE_ANCHORS
  const from = a[i]; const to = a[(i + 1) % 6] + (i === 5 ? 360 : 0)
  return (from + (d - i * 60) / 60 * (to - from)) % 360
}

// ---- CIE Lab and CIEDE2000 (evaluation metric) ----
export function linearSrgbToLab(rgb: readonly number[]): Vec3 {
  const white = xyToXyz(...D65_XY); const xyz = linearSrgbToXyz(rgb)
  const f = (t: number): number => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116
  const [fx, fy, fz] = [0, 1, 2].map(i => f(xyz[i] / white[i]))
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
/** Sharma, Wu & Dalal (2005) reference implementation; kL = kC = kH = 1. */
export function deltaE2000(lab1: readonly number[], lab2: readonly number[]): number {
  const [L1, a1, b1] = lab1; const [L2, a2, b2] = lab2
  const rad = Math.PI / 180
  const C1 = Math.hypot(a1, b1); const C2 = Math.hypot(a2, b2); const Cm = (C1 + C2) / 2
  const G = .5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
  const a1p = a1 * (1 + G); const a2p = a2 * (1 + G)
  const C1p = Math.hypot(a1p, b1); const C2p = Math.hypot(a2p, b2)
  const hp = (b: number, a: number): number => { if (a === 0 && b === 0) return 0; const h = Math.atan2(b, a) / rad; return h < 0 ? h + 360 : h }
  const h1p = hp(b1, a1p); const h2p = hp(b2, a2p)
  const dLp = L2 - L1; const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360 }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * rad)
  const Lpm = (L1 + L2) / 2; const Cpm = (C1p + C2p) / 2
  let hpm = h1p + h2p
  if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) <= 180) hpm /= 2; else hpm = h1p + h2p < 360 ? (hpm + 360) / 2 : (hpm - 360) / 2 }
  const T = 1 - .17 * Math.cos((hpm - 30) * rad) + .24 * Math.cos(2 * hpm * rad) + .32 * Math.cos((3 * hpm + 6) * rad) - .2 * Math.cos((4 * hpm - 63) * rad)
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7))
  const Sl = 1 + .015 * (Lpm - 50) ** 2 / Math.sqrt(20 + (Lpm - 50) ** 2); const Sc = 1 + .045 * Cpm; const Sh = 1 + .015 * Cpm * T
  const Rt = -Math.sin(2 * dTheta * rad) * Rc
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))
}
