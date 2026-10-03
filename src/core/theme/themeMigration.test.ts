import { describe, expect, it } from 'vitest'

import {
  ACCENT_PRESET_HEX,
  DEFAULT_THEME_COLOR_SCHEME_HEX,
  LEGACY_DEFAULT_THEME_COLOR_SCHEME_HEX,
  LEGACY_NEUTRAL_THEME_COLOR_SCHEME_HEX,
  LEGACY_THEME_PALETTE_PRESET_HEX,
  SETTINGS_ACCENT_HEX,
  THEME_PALETTE_PRESET_HEX,
} from './colorTokens'
import { contrastRatio, deltaEOK, normalizeHex } from './themeColor'
import { DEFAULT_THEME_SEED, THEME_PRESETS, THEME_TEXT_MIN_CONTRAST, deriveThemeTokens } from './themeEngine'
import {
  THEME_V1_OVERRIDE_DELTA_E,
  THEME_V1_TOKEN_MAP,
  createThemePayloadV2,
  findThemePresetId,
  fitV1Colors,
  migrateV1Theme,
  migrateV1ThemeSettings,
  normalizeV1Colors,
  parseThemePayload,
  seedAccentFromV1,
  type ThemePayloadV1,
} from './themeMigration'

const v1Payload = (colors: Record<string, string>, overrides: Partial<ThemePayloadV1> = {}): ThemePayloadV1 => ({
  version: 1,
  themeTonePreset: 'neutral',
  uiRadiusPreset: 'default',
  accentColor: SETTINGS_ACCENT_HEX,
  colors: normalizeV1Colors(colors),
  ...overrides,
})

/** 全部 v1 内置方案（迁移时都直接换石墨） */
const BUILT_IN_SCHEMES = [
  DEFAULT_THEME_COLOR_SCHEME_HEX,
  LEGACY_DEFAULT_THEME_COLOR_SCHEME_HEX,
  LEGACY_NEUTRAL_THEME_COLOR_SCHEME_HEX,
  ...THEME_PALETTE_PRESET_HEX.map((preset) => preset.colors),
  ...LEGACY_THEME_PALETTE_PRESET_HEX.map((preset) => preset.colors),
]

/** 把内置方案改动一个颜色，模拟真正自定义过 9 色的用户 */
const customize = (colors: Record<string, string>) => ({ ...normalizeV1Colors(colors), bg: normalizeV1Colors(colors).panel })

/** 拟合能力验证：用 6 个非默认内置方案的配色检验拟合质量（实际迁移时它们走石墨，这里直接调用 fitV1Colors） */
const FIT_CASES = [
  ...THEME_PALETTE_PRESET_HEX.filter((preset) => preset.id !== 'default').map((preset) => ({ name: `v1:${preset.id}`, colors: preset.colors })),
  ...LEGACY_THEME_PALETTE_PRESET_HEX.slice(2).map((preset) => ({ name: `legacy:${preset.id}`, colors: preset.colors })),
]

describe('themeMigration v1 → v2', () => {
  it('未自定义 9 色（全部 12 个内置方案，含 3 个灰阶预设与旧版彩色预设）迁移为石墨，不拟合、无覆盖', () => {
    expect(BUILT_IN_SCHEMES).toHaveLength(12)
    for (const colors of BUILT_IN_SCHEMES) {
      const result = migrateV1Theme({ colors: normalizeV1Colors(colors), accentColor: SETTINGS_ACCENT_HEX, uiRadiusPreset: 'large' })
      expect(result.strategy).toBe('builtIn')
      expect(result.payload).toEqual({ version: 2, seed: DEFAULT_THEME_SEED, uiRadiusPreset: 'large' })
    }
  })

  it('内置方案但单独改过强调色：保留用户强调色作为种子 accent', () => {
    const accent = ACCENT_PRESET_HEX[7]
    for (const colors of BUILT_IN_SCHEMES) {
      const payload = migrateV1ThemeSettings({ themeColors: colors, accentColor: accent })
      expect(payload).toEqual({ version: 2, seed: { ...DEFAULT_THEME_SEED, accent: normalizeHex(accent) }, uiRadiusPreset: 'default' })
    }
  })

  it('旧默认强调色在拟合路径同样视为跟随预设，改过的强调色保留', () => {
    const colors = customize(THEME_PALETTE_PRESET_HEX[3].colors)
    expect(migrateV1Theme({ colors, accentColor: SETTINGS_ACCENT_HEX, uiRadiusPreset: 'default' }).payload.seed.accent).toBe(DEFAULT_THEME_SEED.accent)
    expect(migrateV1Theme({ colors, accentColor: ACCENT_PRESET_HEX[5], uiRadiusPreset: 'default' }).payload.seed.accent).toBe(normalizeHex(ACCENT_PRESET_HEX[5]))
    expect(seedAccentFromV1(null)).toBe(DEFAULT_THEME_SEED.accent)
  })

  it('真正自定义过 9 色才走拟合', () => {
    const result = migrateV1Theme({ colors: customize(THEME_PALETTE_PRESET_HEX[3].colors), accentColor: SETTINGS_ACCENT_HEX, uiRadiusPreset: 'default' })
    expect(result.strategy).toBe('fit')
    expect(result.payload.overrides).toBeDefined()
  })

  it.each(FIT_CASES)('$name：拟合后关键令牌色差 ≤ 阈值（超出者进入 overrides 或因对比度被拒）', ({ colors }) => {
    const fitted = fitV1Colors(normalizeV1Colors(colors), SETTINGS_ACCENT_HEX)
    const result = { report: fitted.report }
    const derived = deriveThemeTokens(fitted.seed, fitted.overrides).colors
    const v1 = normalizeV1Colors(colors)
    for (const [v1Token, token] of THEME_V1_TOKEN_MAP) {
      const entry = result.report.find((item) => item.v1Token === v1Token)!
      if (entry.rejected) {
        // 旧方案的文字色本身不达标：保留引擎值，迁移后仍满足对比度
        expect(contrastRatio(derived[token], derived.selected)).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
        continue
      }
      expect({ v1Token, deltaE: deltaEOK(v1[v1Token], derived[token]) <= THEME_V1_OVERRIDE_DELTA_E }).toEqual({ v1Token, deltaE: true })
    }
  })

  it('彩色旧预设拟合出对应的色相与倾向', () => {
    const fit = (id: string) => fitV1Colors(
      normalizeV1Colors(LEGACY_THEME_PALETTE_PRESET_HEX.find((preset, index) => index >= 2 && preset.id === id)!.colors),
      SETTINGS_ACCENT_HEX,
    ).seed
    expect(fit('slate-night')).toMatchObject({ mode: 'dark' })
    expect(fit('slate-night').hue).toBeGreaterThan(240)
    expect(fit('slate-night').hue).toBeLessThan(290)
    expect(fit('slate-night').tint).toBeGreaterThan(0.02)
    expect(fit('warm-film').hue).toBeGreaterThan(30)
    expect(fit('warm-film').hue).toBeLessThan(90)
    // 彩色旧预设色阶接近线性：窗口、面板几乎无误差，覆盖很少
    const result = fitV1Colors(normalizeV1Colors(LEGACY_THEME_PALETTE_PRESET_HEX[4].colors), SETTINGS_ACCENT_HEX)
    expect(result.report.find((item) => item.token === 'window')!.deltaE).toBeLessThan(0.01)
    expect(result.report.find((item) => item.token === 'panel')!.deltaE).toBeLessThan(0.01)
  })

  it('色调 themeTonePreset 被忽略', () => {
    const colors = customize(THEME_PALETTE_PRESET_HEX[2].colors)
    const neutral = parseThemePayload(v1Payload(colors, { themeTonePreset: 'neutral' }))
    expect(parseThemePayload(v1Payload(colors, { themeTonePreset: 'warm' }))).toEqual(neutral)
    expect(parseThemePayload(v1Payload(colors, { themeTonePreset: 'cool' }))).toEqual(neutral)
  })

  it('旧设置读取与 v1 导入走同一迁移，结果一致', () => {
    const colors = customize(LEGACY_THEME_PALETTE_PRESET_HEX[3].colors)
    const accent = ACCENT_PRESET_HEX[3]
    expect(migrateV1ThemeSettings({ themeColors: colors, accentColor: accent, uiRadiusPreset: 'compact' })).toEqual(
      parseThemePayload(v1Payload(colors, { accentColor: accent, uiRadiusPreset: 'compact' }))
    )
  })

  it('旧设置缺字段或值非法时回落默认', () => {
    expect(migrateV1ThemeSettings({})).toEqual({ version: 2, seed: DEFAULT_THEME_SEED, uiRadiusPreset: 'default' })
    expect(migrateV1ThemeSettings({ themeColors: { app: 'not-a-color' }, accentColor: null, uiRadiusPreset: 'huge' })).toEqual({
      version: 2,
      seed: DEFAULT_THEME_SEED,
      uiRadiusPreset: 'default',
    })
  })
})

describe('themeMigration payload v2', () => {
  it('导出 → JSON → 导入往返一致（含 overrides）', () => {
    const fitted = migrateV1Theme({
      colors: customize(THEME_PALETTE_PRESET_HEX[3].colors),
      accentColor: ACCENT_PRESET_HEX[5],
      uiRadiusPreset: 'large',
    }).payload
    expect(fitted.overrides).toBeDefined()
    for (const payload of [
      fitted,
      createThemePayloadV2({ seed: { ...THEME_PRESETS.paper.seed, contrast: 1.35 } }),
      createThemePayloadV2({ seed: THEME_PRESETS.ocean.seed, overrides: { mediaScrim: 'rgba(0, 0, 0, 0.4)' }, uiRadiusPreset: 'compact' }),
    ]) {
      const imported = parseThemePayload(JSON.parse(JSON.stringify(payload)))
      expect(imported).toEqual(payload)
      expect(parseThemePayload(JSON.parse(JSON.stringify(imported)))).toEqual(imported)
    }
  })

  it('导入时规范化种子与覆盖：未知令牌、非法颜色被丢弃，rgba 统一格式', () => {
    const imported = parseThemePayload({
      version: 2,
      seed: { mode: 'light', hue: 400, tint: 0.5, base: 0.97, contrast: 1, accent: '3a6fdf' },
      overrides: { window: 'abcdef', notAToken: 'abcdef', panel: 'nope', scrim: 'rgb(0 0 0 / 0.3)' },
      uiRadiusPreset: 'default',
    })
    expect(imported?.seed).toMatchObject({ mode: 'light', hue: 40, tint: 0.08, accent: THEME_PRESETS.paper.seed.accent })
    expect(imported?.overrides).toEqual({ window: normalizeHex('abcdef'), scrim: 'rgba(0,0,0,0.3)' })
  })

  it('格式不对返回 null', () => {
    expect(parseThemePayload(null)).toBeNull()
    expect(parseThemePayload('x')).toBeNull()
    expect(parseThemePayload({ version: 3 })).toBeNull()
    expect(parseThemePayload({ version: 2, seed: { mode: 'sepia' }, uiRadiusPreset: 'default' })).toBeNull()
    expect(parseThemePayload({ version: 2, seed: DEFAULT_THEME_SEED, uiRadiusPreset: 'huge' })).toBeNull()
    expect(parseThemePayload({ version: 1, themeTonePreset: 'sepia', uiRadiusPreset: 'default' })).toBeNull()
  })

  it('按底色识别预设（强调色、对比度可不同）', () => {
    expect(findThemePresetId({ ...THEME_PRESETS.film.seed, contrast: 1.35, accent: ACCENT_PRESET_HEX[0] })).toBe('film')
    expect(findThemePresetId({ ...THEME_PRESETS.film.seed, hue: 71 })).toBeNull()
  })
})
