import { describe, expect, it } from 'vitest'
import { buildColorGradeTable, gradeStageA, gradeStageB } from './unifiedGrade'
import { colorGradeDefaults } from './schema'
import { colorGradeCurvePoints, colorGradeSpline } from './curves'
import { migrateColorGradeParamsV1 } from './colorGradeMigration'
import { deltaE2000, illuminantXy, linearSrgbToLab, linearSrgbToOklab, linearToSrgb, srgbToLinear, xyToXyz, xyzToLinearSrgb, type Vec3 } from './colorScience'

type Params = Record<string, unknown>
const grade = (rgb: Vec3, params: Params): Vec3 => { const table = buildColorGradeTable({ ...colorGradeDefaults(), ...params }); return table.stageB ? gradeStageB(gradeStageA(rgb, table.data), table.data) : gradeStageA(rgb, table.data) }
const lch = (encoded: readonly number[]): [number, number, number] => { const lab = linearSrgbToOklab(encoded.map(srgbToLinear)); return [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1]) * 180 / Math.PI] }
const PATCHES: Vec3[] = []
for (const r of [.08, .3, .55, .8, .95]) for (const g of [.08, .3, .55, .8, .95]) for (const b of [.08, .3, .55, .8, .95]) PATCHES.push([r, g, b])
PATCHES.push([.87, .67, .55], [.62, .44, .34], [.36, .24, .17]) // light / medium / deep skin

/** Pointwise v1 pipeline (basic → creative → curves → wheels) copied from the pre-2026-10-21 CPU kernel for comparison. */
function legacyGrade(rgb: Vec3, p: Params): Vec3 {
  const n = (key: string): number => Number(p[key] ?? 0)
  const clamp = (x: number): number => Math.max(0, Math.min(1, x)); const smooth = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
  const luma = (c: readonly number[]): number => c[0] * .2126 + c[1] * .7152 + c[2] * .0722
  const weights = (c: readonly number[]): Vec3 => { const y = clamp(luma(c)); const s = 1 - smooth(0, .5, y); const h = smooth(.5, 1, y); return [s, 1 - s - h, h] }
  const tint = (h: number): Vec3 => { const base = [0, 2 / 3, 1 / 3].map(o => clamp(Math.abs(((h / 360 + o) % 1 + 1) % 1 * 6 - 3) - 1)); const y = luma(base); return base.map(x => x - y) as Vec3 }
  const gains = [1 + .003 * n('temperature'), 1 - .0025 * n('tint'), 1 - .003 * n('temperature')]; const gy = luma(gains); const e = 2 ** n('exposure')
  let c = rgb.map((x, i) => linearToSrgb(srgbToLinear(x) * gains[i] / gy * e)) as Vec3
  const y = clamp(luma(c)); const w = weights(c); const k = n('contrast') / 100
  const offset = n('highlights') / 100 * w[2] * .25 + n('shadows') / 100 * w[0] * .25 + n('whites') / 100 * y ** 4 * .25 + n('blacks') / 100 * (1 - y) ** 4 * .25
  c = c.map(x => (x - .5) * (k >= 0 ? 1 + 2 * k : 1 + k) + .5 + offset) as Vec3
  const sat = Math.max(...c) - Math.min(...c); const y2 = luma(c)
  c = c.map(x => y2 + (x - y2) * Math.max(0, 1 + n('saturation') / 100 + n('vibrance') / 100 * (1 - clamp(sat)))) as Vec3
  const w2 = weights(c); const shadowTint = tint(n('creative_shadow_hue')); const highTint = tint(n('creative_highlight_hue'))
  c = c.map((x, i) => x + (x * .75 + .125 - x) * n('faded_film') / 100 + shadowTint[i] * n('creative_shadow_strength') / 100 * w2[0] * .25 + highTint[i] * n('creative_highlight_strength') / 100 * w2[2] * .25) as Vec3
  for (const [index, channel] of ['master', 'red', 'green', 'blue'].entries()) {
    const points = colorGradeCurvePoints(p, channel); if (points.every(point => point.x === point.y)) continue
    const f = colorGradeSpline(points); c = c.map((x, i) => index === 0 || i === index - 1 ? f(clamp(x) * 100) / 100 : x) as Vec3
  }
  for (const [index, region] of ['shadow', 'midtone', 'highlight'].entries()) {
    const ww = weights(c)[index]; const t = tint(n(`${region}_hue`)); c = c.map((x, i) => x + (t[i] * n(`${region}_strength`) / 100 + n(`${region}_luminance`) / 100) * .25 * ww) as Vec3
  }
  return c
}
function report(v1: Params): { mean: number; max: number } {
  const migrated = migrateColorGradeParamsV1(v1)
  // Compare what an SDR display shows: both renderers leave out-of-range values for the output transfer to clip.
  const shown = (rgb: readonly number[]): Vec3 => rgb.map(x => srgbToLinear(Math.max(0, Math.min(1, x)))) as Vec3
  const errors = PATCHES.map(rgb => deltaE2000(linearSrgbToLab(shown(legacyGrade(rgb, v1))), linearSrgbToLab(shown(grade(rgb, migrated)))))
  return { mean: errors.reduce((a, b) => a + b, 0) / errors.length, max: Math.max(...errors) }
}

describe('unified color grade', () => {
  it('is an exact identity and plans no pass at defaults', () => {
    const table = buildColorGradeTable(colorGradeDefaults())
    expect(table.stageA).toBe(false); expect(table.stageB).toBe(false)
    for (const rgb of PATCHES.slice(0, 20)) grade(rgb, {}).forEach((x, i) => expect(x).toBe(rgb[i]))
  })
  it('neutralizes the named light and keeps hue under contrast and tone changes', () => {
    const lit = xyzToLinearSrgb(xyToXyz(...illuminantXy(3200), .25)).map(linearToSrgb) as Vec3
    const corrected = grade(lit, { temperature_kelvin: 3200 })
    expect(lch(corrected)[1]).toBeLessThan(1e-4)
    for (const rgb of [[.7, .3, .2], [.2, .5, .8]] as Vec3[]) {
      const before = lch(rgb); const after = lch(grade(rgb, { contrast: 60, shadows: 30, tone_darks: 25 }))
      expect(Math.abs(after[2] - before[2])).toBeLessThan(.5)
    }
    expect(lch(grade([.9, .75, .7], { contrast: 60 }))[0]).toBeGreaterThan(lch([.9, .75, .7])[0] + .02)
    expect(lch(grade([.7, .3, .2], { saturation: -100 }))[1]).toBeLessThan(1e-4)
  })
  it('keeps highlight chroma continuous when contrast pushes luminance past white', () => {
    const shown = (rgb: readonly number[]): Vec3 => rgb.map(x => srgbToLinear(Math.max(0, Math.min(1, x)))) as Vec3
    let previous = grade([.9, .83, .18], { exposure: .4, contrast: 20 }); let worst = 0
    for (let step = 1; step <= 24; step++) {
      const t = step / 256; const current = grade([.9 + t, .83 + t, .18 + t * .3], { exposure: .4, contrast: 20 })
      worst = Math.max(worst, deltaE2000(linearSrgbToLab(shown(previous)), linearSrgbToLab(shown(current)))); previous = current
    }
    expect(worst).toBeLessThan(2)
  })
  it('limits mixer changes to the named color and skips greys', () => {
    const red = grade([.85, .15, .12], { mixer_red_saturation: -100 }); const blue = grade([.15, .25, .85], { mixer_red_saturation: -100 })
    expect(lch(red)[1]).toBeLessThan(lch([.85, .15, .12])[1] * .1)
    blue.forEach((x, i) => expect(x).toBeCloseTo([.15, .25, .85][i], 6))
    grade([.4, .4, .4], { mixer_green_luminance: 80, mixer_blue_hue: 50 }).forEach(x => expect(x).toBeCloseTo(.4, 6))
  })
  it('implements Lift/Gamma/Gain/Offset in primary mode', () => {
    const lifted = grade([0, 0, 0], { wheel_mode: 'primary', shadow_luminance: 40 })
    lifted.forEach(x => expect(x).toBeCloseTo(.1, 6))
    const gained = grade([.5, .5, .5], { wheel_mode: 'primary', highlight_luminance: 20 })
    gained.forEach(x => expect(x).toBeCloseTo(.6, 6))
    expect(grade([.5, .5, .5], { wheel_mode: 'primary', midtone_luminance: 50 })[0]).toBeGreaterThan(.5)
  })
  it('stays close to the v1 renderer after migration (ΔE2000 over 128 patches, as an SDR display shows them)', () => {
    const cases: Array<[string, Params, number, number]> = [
      ['白平衡', { temperature: 30, tint: -10 }, 1, 2],
      ['曝光', { exposure: .7 }, .01, .05],
      ['曲线', { curve_master_points: [{ x: 0, y: 0 }, { x: 40, y: 50 }, { x: 100, y: 100 }], curve_red_points: [{ x: 0, y: 5 }, { x: 100, y: 95 }] }, .01, .05],
      ['色轮', { shadow_hue: 220, shadow_strength: 20, highlight_hue: 40, highlight_strength: 15, midtone_luminance: 10 }, .1, .5],
      ['淡化+分离色调', { faded_film: 30, creative_shadow_hue: 200, creative_shadow_strength: 25 }, .1, .5],
      // Contrast and saturation are deliberate algorithm changes (luminance-only, hue-preserving, OkLCh); these bound the drift.
      ['对比度', { contrast: 25 }, 5.5, 27],
      ['对比度-', { contrast: -25 }, 2.5, 8],
      ['高光', { highlights: -30 }, .5, 2],
      ['阴影', { shadows: 25 }, .5, 2.5],
      ['白黑', { whites: 20, blacks: -20 }, .5, 1.5],
      ['饱和度', { saturation: 30 }, 2.5, 8.5],
      ['自然饱和度', { vibrance: 20 }, 1, 2.5],
    ]
    for (const [name, v1, meanLimit, maxLimit] of cases) {
      const { mean, max } = report(v1)
      expect(mean, `${name} 平均 ΔE`).toBeLessThan(meanLimit); expect(max, `${name} 最大 ΔE`).toBeLessThan(maxLimit)
    }
  })
})
