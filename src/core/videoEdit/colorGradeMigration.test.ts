import { describe, expect, it } from 'vitest'
import { migrateEmbeddedVideoColorGradesV1, migrateVideoColorGradeInstanceV1 } from './colorGradeMigration'
import { legacyWhiteBalanceToKelvin } from '../imaging/adjustments/colorGradeMigration'
import { videoEditDocumentKind } from '../documents/kinds/videoEdit'
import { FORMAT_MIGRATIONS } from '../persistence/formatMigrations'
import { videoEditBuiltinEffectIssue } from './builtinEffects'
import { assertVideoEditBuiltinCurves, type VideoEditCurves } from './keyframes'

type Instance = { id: string; params: Record<string, unknown>; curves?: VideoEditCurves }

describe('video color grade v1 → v2 migration', () => {
  it('converts animated temperature with static tint at every keyframe and keeps interpolation', () => {
    const instance: Instance = { id: 'color_grade', params: { temperature: 0, tint: 10, exposure: .5 }, curves: { temperature: [{ time: 0, value: -20, interpolation: 'ease' as const }, { time: 30, value: 40, interpolation: 'linear' as const }], exposure: [{ time: 0, value: 0, interpolation: 'linear' as const }] } }
    const next = migrateVideoColorGradeInstanceV1(instance)
    expect(next.curves).not.toHaveProperty('temperature')
    expect(next.curves!.temperature_kelvin.map(point => point.value)).toEqual([legacyWhiteBalanceToKelvin(-20, 10).temperature_kelvin, legacyWhiteBalanceToKelvin(40, 10).temperature_kelvin])
    expect(next.curves!.tint.map(point => point.value)).toEqual([legacyWhiteBalanceToKelvin(-20, 10).tint, legacyWhiteBalanceToKelvin(40, 10).tint])
    expect(next.curves!.temperature_kelvin.map(point => point.interpolation)).toEqual(['ease', 'linear'])
    expect(next.curves!.exposure).toEqual(instance.curves!.exposure)
    expect(videoEditBuiltinEffectIssue(next)).toBeUndefined()
    expect(() => assertVideoEditBuiltinCurves(next)).not.toThrow()
  })
  it('merges creative tint keyframes at the union of times', () => {
    const instance: Instance = { id: 'color_grade', params: { shadow_hue: 220, shadow_strength: 10, creative_shadow_hue: 30, creative_shadow_strength: 0 }, curves: { creative_shadow_strength: [{ time: 10, value: 0, interpolation: 'linear' as const }, { time: 20, value: 20, interpolation: 'linear' as const }], shadow_strength: [{ time: 15, value: 10, interpolation: 'hold' as const }] } }
    const next = migrateVideoColorGradeInstanceV1(instance)
    expect(next.curves!.shadow_strength.map(point => point.time)).toEqual([10, 15, 20])
    expect(next.curves!.shadow_hue.map(point => point.time)).toEqual([10, 15, 20])
    expect(next.curves).not.toHaveProperty('creative_shadow_strength')
    expect(next.curves!.shadow_strength[0].value).toBeCloseTo(10, 6)
    expect(videoEditBuiltinEffectIssue(next)).toBeUndefined()
  })
  it('walks documents and preset packages, leaving other effects untouched', () => {
    const blur = { id: 'b', name: '模糊', enabled: true, amount: 1, builtin: { id: 'gaussian_blur', params: { temperature: 1 } } }
    const grade = { id: 'g', name: '全能调色', enabled: true, amount: 1, builtin: { id: 'color_grade', params: { temperature: 25 } } }
    const content = { sequences: [{ clips: [{ effects: [grade, blur] }] }] }
    const migrated = videoEditDocumentKind.migrations[17](content) as typeof content
    const params = migrated.sequences[0].clips[0].effects[0].builtin.params as Record<string, number>
    expect(Object.keys(params).sort()).toEqual(['temperature_kelvin', 'tint'])
    expect(params.temperature_kelvin).toBeCloseTo(legacyWhiteBalanceToKelvin(25, 0).temperature_kelvin, 2)
    expect(migrated.sequences[0].clips[0].effects[1]).toEqual(blur)
    expect(content.sequences[0].clips[0].effects[0].builtin.params).toEqual({ temperature: 25 })
    const pack = FORMAT_MIGRATIONS['video-preset-package'][5]({ format: 'henji-video-presets', version: 5, entries: [{ category: 'effect', preset: { effects: [grade] } }] }) as { version: number }
    expect(pack.version).toBe(6)
    expect(JSON.stringify(migrateEmbeddedVideoColorGradesV1(pack))).not.toContain('"temperature"')
  })
})
