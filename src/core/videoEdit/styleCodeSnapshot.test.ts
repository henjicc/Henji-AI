import { expect, it } from 'vitest'
import { videoEditEffectPresetSchema, resolveVideoEditStylePieceEffects, markVideoEditStylePieceForeign } from './effectPresets'
import { styleCodeFixture } from './styleCodeTestFixtures'
import { resolveAuthorEffects } from './authorEffects'
import { videoEditStyleContentHash } from './styles/styleSchemas'
import { BLANK_STYLE_SAMPLE_SOURCE } from './styles/blankSample'
import { videoEditStyleSampleSchema } from './styles/styleSchemas'

it('代码快照旋钮按声明范围校验，覆盖映射参数的曲线，look 拒绝代码成员', () => {
  const preset = styleCodeFixture()
  expect(resolveVideoEditStylePieceEffects(preset, { strength: 80 })[0].code).toMatchObject({ parameters: { gain: .8 } })
  expect(resolveVideoEditStylePieceEffects(preset)[0].code!.curves).toBeUndefined()
  expect(() => videoEditEffectPresetSchema.parse({ ...preset, knobs: [{ ...preset.knobs![0], mappings: [{ ...preset.knobs![0].mappings[0], points: [{ input: 0, output: 0 }, { input: 100, output: 2 }] }] }] })).toThrow('映射值')
  expect(() => videoEditEffectPresetSchema.parse({ ...preset, codeSnapshots: {} })).toThrow('完整')
  expect(() => resolveAuthorEffects([{ id: 'look', params: { name: preset.name } }], { presets: [preset] })).toThrow('片段效果链')
  const imported = markVideoEditStylePieceForeign(preset, { id: 'external', sourceName: '风格包', sourceType: 'style_package' })
  expect(imported.codeSnapshots!.code.version.foreign?.id).toBe('external')
  expect(preset.codeSnapshots!.code.version.foreign).toBeUndefined()
})

it('风格包导入补来源标记不改变内容摘要', async () => {
  const preset = styleCodeFixture(), foreign = { id: 'external', sourceName: '风格包', sourceType: 'style_package' as const }
  const style = { guide: '风格', sample: videoEditStyleSampleSchema.parse({ code: { entry: 'index.js', files: { 'index.js': BLANK_STYLE_SAMPLE_SOURCE } } }), effectPresets: [preset] }
  expect(await videoEditStyleContentHash({ ...style, effectPresets: [markVideoEditStylePieceForeign(preset, foreign)] })).toBe(await videoEditStyleContentHash(style))
})
