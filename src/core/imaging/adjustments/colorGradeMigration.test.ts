import { describe, expect, it } from 'vitest'
import { combineWheelTints, legacyWhiteBalanceToKelvin, migrateColorGradeParamsV1, whiteBalanceConversionResidual } from './colorGradeMigration'
import { whiteBalanceMatrix } from './colorScience'
import { colorGradeTintVector } from './unifiedGrade'
import { imageColorGradeParamsSchema } from './schema'
import { FORMAT_MIGRATIONS } from '../../persistence/formatMigrations'

describe('color grade v1 → v2 migration', () => {
  it('solves kelvin/Duv so grey keeps exactly the old white balance chromaticity', () => {
    for (const temperature of [-100, -37, 0, 12, 100]) for (const tint of [-100, -8, 0, 45, 100]) {
      expect(whiteBalanceConversionResidual(temperature, tint, whiteBalanceMatrix)).toBeLessThan(1e-6)
      const { temperature_kelvin, tint: duvTint } = legacyWhiteBalanceToKelvin(temperature, tint)
      expect(temperature_kelvin).toBeGreaterThanOrEqual(2000); expect(temperature_kelvin).toBeLessThanOrEqual(20000)
      expect(Math.abs(duvTint)).toBeLessThanOrEqual(100)
    }
    expect(legacyWhiteBalanceToKelvin(0, 0)).toEqual({ temperature_kelvin: 6500, tint: 0 })
    // Old warm (+) maps above the reference, old cool (−) below.
    expect(legacyWhiteBalanceToKelvin(40, 0).temperature_kelvin).toBeGreaterThan(6500)
    expect(legacyWhiteBalanceToKelvin(-40, 0).temperature_kelvin).toBeLessThan(6500)
  })
  it('sums duplicated creative split toning into the wheels as the same tint vector', () => {
    const merged = combineWheelTints({ hue: 220, strength: 10 }, { hue: 30, strength: 15 })
    const expected = colorGradeTintVector(220).map((x, i) => x * 10 + colorGradeTintVector(30)[i] * 15)
    colorGradeTintVector(merged.hue).map(x => x * merged.strength).forEach((x, i) => expect(x).toBeCloseTo(expected[i], 4))
    expect(combineWheelTints({ hue: 10, strength: 0 }, { hue: 200, strength: 20 })).toEqual({ hue: 200, strength: 20 })
  })
  it('produces parameters the v2 schema accepts and drops every removed key', () => {
    const v1 = { exposure: .25, temperature: 18, tint: -6, creative_shadow_hue: 200, creative_shadow_strength: 20, creative_highlight_hue: 40, creative_highlight_strength: 0, shadow_hue: 0, shadow_strength: 0, highlight_hue: 0, highlight_strength: 0 }
    const v2 = migrateColorGradeParamsV1(v1)
    expect(v2).not.toHaveProperty('temperature'); expect(v2).not.toHaveProperty('creative_shadow_hue')
    expect(v2).toMatchObject({ exposure: .25, shadow_hue: 200, shadow_strength: 20, highlight_strength: 0 })
    expect(imageColorGradeParamsSchema.safeParse(v2).success).toBe(true)
    expect(v1).toHaveProperty('temperature', 18)
  })
  it('migrates color grade layers at any depth of image working copies and packages', () => {
    const layer = (params: Record<string, unknown>) => ({ type: 'adjustment', adjustmentId: 'color_grade', params })
    const working = { format: 'henji-image-edit', formatVersion: 14, document: { layers: [layer({ temperature: 30 }), { type: 'group', children: [layer({ creative_highlight_hue: 50, creative_highlight_strength: 10 })] }, { type: 'adjustment', adjustmentId: 'hsl', params: { temperature: 3 } }] } }
    const next = FORMAT_MIGRATIONS['image-working-copy'][14](working) as typeof working
    expect(next.formatVersion).toBe(15)
    expect((next.document.layers[0] as unknown as { params: { temperature_kelvin: number } }).params.temperature_kelvin).toBeCloseTo(legacyWhiteBalanceToKelvin(30, 0).temperature_kelvin, 2)
    expect((next.document.layers[1] as { children: Array<{ params: Record<string, unknown> }> }).children[0].params).toMatchObject({ highlight_hue: 50, highlight_strength: 10 })
    expect(next.document.layers[2]).toEqual(working.document.layers[2])
    const pack = FORMAT_MIGRATIONS['image-package'][12]({ packageVersion: 12, document: working }) as { packageVersion: number; document: { formatVersion: number } }
    expect(pack.packageVersion).toBe(13); expect(pack.document.formatVersion).toBe(15)
  })
})
