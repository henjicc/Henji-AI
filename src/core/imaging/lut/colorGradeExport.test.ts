import { describe, expect, it } from 'vitest'
import { colorGradeDefaults } from '../adjustments/schema'
import { encodeColorGradeCurve } from '../adjustments/curves'
import { parseCubeLut } from './cube'
import { applyAscCdl, buildColorGradeExport, ColorGradeExportRejection, gradeEncodedColors, measureColorGradeExport, parseAscCdl } from './colorGradeExport'

const grade = (values: Record<string, unknown>): Record<string, unknown> => ({ ...colorGradeDefaults(), ...values })
// 实测（512 个准随机测试色，ΔE2000 平均/最大）：BASIC 33 格 0.10/1.49、65 格 0.03/0.63；CREATIVE 33 格 0.18/3.47、65 格 0.06/1.55。
const BASIC = grade({ temperature_kelvin: 4800, tint: 8, contrast: 20, saturation: 15, highlights: -20, shadows: 15 })
const CREATIVE = grade({ temperature_kelvin: 7200, contrast: 25, saturation: -10, vibrance: 20, faded_film: 15, mixer_orange_hue: 20, mixer_blue_saturation: -40, mixer_green_luminance: 30,
  curve_hue_sat_points: encodeColorGradeCurve([{ x: 0, y: 50 }, { x: 50, y: 80 }, { x: 100, y: 50 }]), shadow_hue: 200, shadow_strength: 20, highlight_hue: 40, highlight_strength: 15,
  curve_master_points: encodeColorGradeCurve([{ x: 0, y: 4 }, { x: 25, y: 20 }, { x: 75, y: 82 }, { x: 100, y: 98 }]) })

describe('全能调色导出 .cube / .cdl', () => {
  it('33 与 65 格点 .cube 用正式解析器读回，测试色与 CPU 调色的差异在可接受范围', () => {
    for (const [params, limits] of [[BASIC, { 33: [.15, 2], 65: [.05, .9] }], [CREATIVE, { 33: [.25, 4.5], 65: [.1, 2] }]] as const) {
      for (const size of [33, 65] as const) {
        const built = buildColorGradeExport({ params, format: 'cube', title: '测试', lutSize: size })
        const lut = parseCubeLut(built.text)
        expect(lut.kind).toBe('3d'); expect(lut.size).toBe(size); expect(lut.title).toBe('测试')
        const accuracy = measureColorGradeExport('cube', built.text, built.check)
        expect(accuracy.samples).toBe(512)
        expect(accuracy.meanDeltaE).toBeLessThan(limits[size][0]); expect(accuracy.maxDeltaE).toBeLessThan(limits[size][1])
      }
    }
  })
  it('格点顺序为红最快：格点值就是该色的正式调色结果', () => {
    const built = buildColorGradeExport({ params: BASIC, format: 'cube', title: 'x', lutSize: 17 })
    const lut = parseCubeLut(built.text)
    const index = (r: number, g: number, b: number): number => (b * 17 * 17 + g * 17 + r) * 4
    const expected = gradeEncodedColors(BASIC, Float32Array.from([1, 0, 0, 0, 1, 0, .5, .25, .75]))
    for (let c = 0; c < 3; c++) {
      expect(lut.data[index(16, 0, 0) + c]).toBeCloseTo(expected[c], 5)
      expect(lut.data[index(0, 16, 0) + c]).toBeCloseTo(expected[3 + c], 5)
      expect(lut.data[index(8, 4, 12) + c]).toBeCloseTo(expected[6 + c], 5)
    }
  })
  it('中性调色导出恒等 LUT；锐化、晕影不进 LUT 并如实列出', () => {
    const built = buildColorGradeExport({ params: grade({ sharpen: 30, vignette_amount: -40 }), format: 'cube', title: 'x', lutSize: 17 })
    expect(built.omitted).toEqual(['锐化', '晕影'])
    expect(built.text).toContain('# 未包含：锐化、晕影')
    expect(measureColorGradeExport('cube', built.text, { inputs: built.check.inputs, expected: built.check.inputs }).maxDeltaE).toBeLessThan(.05)
  })
  it('基本校正可以近似为 CDL；读回后与正式调色的差异在上限内', () => {
    const built = buildColorGradeExport({ params: grade({ temperature_kelvin: 5200, exposure: .3, saturation: 12 }), format: 'cdl', title: '镜头 1' })
    const cdl = parseAscCdl(built.text)
    for (const key of ['slope', 'offset', 'power'] as const) cdl[key].forEach((value, c) => expect(value).toBeCloseTo(built.cdl![key][c], 6))
    expect(cdl.saturation).toBeCloseTo(built.cdl!.saturation, 6)
    expect(built.text).toContain('urn:ASC:CDL:v1.01')
    const accuracy = measureColorGradeExport('cdl', built.text, built.check)
    expect(accuracy.meanDeltaE).toBeLessThan(2) // 实测 1.51
    expect(cdl.slope[2]).toBeGreaterThan(cdl.slope[0]) // 5200 K 光源 → 校正后偏冷
  })
  it('中性调色的 CDL 是恒等', () => {
    const built = buildColorGradeExport({ params: grade({}), format: 'cdl', title: 'x' })
    expect(applyAscCdl([.2, .5, .8], built.cdl!).map(x => Number(x.toFixed(3)))).toEqual([.2, .5, .8])
  })
  it('按颜色选择性处理的调色拟合不进 CDL 时拒绝并说明原因', () => {
    const params = grade({ mixer_red_hue: 100, mixer_red_saturation: 100, mixer_blue_hue: -100, mixer_green_saturation: -100, mixer_yellow_luminance: -100, curve_hue_hue_points: encodeColorGradeCurve([{ x: 0, y: 50 }, { x: 33, y: 100 }, { x: 67, y: 0 }, { x: 100, y: 50 }]) })
    expect(() => buildColorGradeExport({ params, format: 'cdl', title: 'x' })).toThrow(ColorGradeExportRejection)
    expect(() => buildColorGradeExport({ params, format: 'cdl', title: 'x' })).toThrow(/混色器、色相曲线.*改为导出 \.cube/)
  })
})
