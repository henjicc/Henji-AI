import { applyMat3, CAT16, D65_XY, invertMat3, xyToXyz, linearSrgbToXyz, TINT_DUV_PER_UNIT, xyToKelvinDuv, xyzToXy, luminance, type Mat3, type Vec3 } from './colorScience'
import { colorGradeTintVector } from './unifiedGrade'

/**
 * Color grade parameter format v1 → v2 (2026-10-21).
 * - `temperature` (relative RGB gains, ±100) and the redefined `tint` become `temperature_kelvin` + Duv `tint`, solved in closed
 *   form so a neutral grey renders with exactly the old chromaticity.
 * - `creative_shadow_*` / `creative_highlight_*` duplicated the shadow/highlight wheels (same tint vector and zone weights);
 *   they are summed into those wheels as luma-neutral vectors.
 * Pure functions: inputs are never mutated.
 */
export const COLOR_GRADE_V1_REMOVED_KEYS = ['temperature', 'creative_shadow_hue', 'creative_shadow_strength', 'creative_highlight_hue', 'creative_highlight_strength'] as const

const CAT16_SRGB = (rgb: Vec3): Vec3 => applyMat3(CAT16, linearSrgbToXyz(rgb))
const CAT16_INVERSE = invertMat3(CAT16)
/** The old linear gains of a v1 white balance (`colorGradeWhiteBalance` before 2026-10-21). */
export function legacyWhiteBalanceGains(temperature: number, tint: number): Vec3 {
  const gains: Vec3 = [1 + .003 * temperature, 1 - .0025 * tint, 1 - .003 * temperature]
  const y = luminance(gains)
  return gains.map(value => value / y) as Vec3
}
/**
 * Which light, adapted to D65, maps grey onto the old gains? Von Kries in CAT16: M·grey ∝ g ⇔ source_lms ∝ d65_lms · grey_lms / g_lms.
 */
export function legacyWhiteBalanceToKelvin(temperature: number, tint: number): { temperature_kelvin: number; tint: number } {
  if (temperature === 0 && tint === 0) return { temperature_kelvin: 6500, tint: 0 }
  const white = CAT16_SRGB([1, 1, 1]); const target = CAT16_SRGB(legacyWhiteBalanceGains(temperature, tint))
  const destination = applyMat3(CAT16, xyToXyz(...D65_XY))
  const sourceLms = white.map((w, i) => destination[i] * w / target[i])
  const xyz = applyMat3(CAT16_INVERSE, sourceLms)
  const light = xyToKelvinDuv(...xyzToXy(xyz))
  return { temperature_kelvin: Math.min(20000, Math.max(2000, light.kelvin)), tint: Math.min(100, Math.max(-100, light.duv / TINT_DUV_PER_UNIT)) }
}

/** Single hue/strength whose wheel tint equals the sum of two v1 tints (strength clamps at 100). */
export function combineWheelTints(a: { hue: number; strength: number }, b: { hue: number; strength: number }): { hue: number; strength: number } {
  if (!b.strength) return { hue: a.hue, strength: a.strength }
  if (!a.strength) return { hue: b.hue, strength: b.strength }
  const va = colorGradeTintVector(a.hue); const vb = colorGradeTintVector(b.hue)
  const target = va.map((x, i) => x * a.strength + vb[i] * b.strength)
  const magnitude = Math.hypot(...target)
  if (magnitude < 1e-9) return { hue: a.hue, strength: 0 }
  let best = { hue: 0, error: Infinity, scale: 0 }
  const fit = (hue: number): void => {
    const v = colorGradeTintVector(hue); const vv = v[0] ** 2 + v[1] ** 2 + v[2] ** 2
    const scale = Math.max(0, (v[0] * target[0] + v[1] * target[1] + v[2] * target[2]) / vv)
    const error = Math.hypot(...v.map((x, i) => x * scale - target[i]))
    if (error < best.error) best = { hue, error, scale }
  }
  for (let hue = 0; hue < 360; hue += .5) fit(hue)
  for (let step = .25; step > 1e-4; step /= 2) { const center = best.hue; fit((center - step + 360) % 360); fit((center + step) % 360) }
  return { hue: Math.round(best.hue * 100) / 100 % 360, strength: Math.min(100, best.scale) }
}

type Params = Record<string, unknown>
const num = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback
/** Static v1 → v2 conversion of one parameter set (image layers and the non-animated values of a video effect). */
export function migrateColorGradeParamsV1(params: Readonly<Params>): Params {
  const result: Params = { ...params }
  for (const key of COLOR_GRADE_V1_REMOVED_KEYS) delete result[key]
  if ('temperature' in params || 'tint' in params) Object.assign(result, roundWhiteBalance(legacyWhiteBalanceToKelvin(num(params.temperature, 0), num(params.tint, 0))))
  for (const zone of ['shadow', 'highlight'] as const) {
    const creative = { hue: num(params[`creative_${zone}_hue`], 0), strength: num(params[`creative_${zone}_strength`], 0) }
    if (!creative.strength) continue
    const merged = combineWheelTints({ hue: num(params[`${zone}_hue`], 0), strength: num(params[`${zone}_strength`], 0) }, creative)
    result[`${zone}_hue`] = merged.hue; result[`${zone}_strength`] = merged.strength
  }
  return result
}
function roundWhiteBalance(value: { temperature_kelvin: number; tint: number }): { temperature_kelvin: number; tint: number } {
  // Six significant decimals keep the closed-form solution while staying readable in documents.
  return { temperature_kelvin: Math.round(value.temperature_kelvin * 1e3) / 1e3, tint: Math.round(value.tint * 1e4) / 1e4 }
}

/** Grey after the v1 gains vs. after the converted v2 matrix: used by tests and the migration report. */
export function whiteBalanceConversionResidual(temperature: number, tint: number, matrix: (kelvin: number, tint: number) => Mat3): number {
  const converted = legacyWhiteBalanceToKelvin(temperature, tint); const m = matrix(converted.temperature_kelvin, converted.tint)
  const grey = applyMat3(m, [.18, .18, .18]); const old = legacyWhiteBalanceGains(temperature, tint).map(x => x * .18)
  return Math.hypot(grey[0] / grey[1] - old[0] / old[1], grey[2] / grey[1] - old[2] / old[1])
}
