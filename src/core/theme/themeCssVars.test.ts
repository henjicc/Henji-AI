import { describe, expect, it } from 'vitest'

import {
  LEGACY_THEME_CSS_ALIASES,
  THEME_TOKEN_CSS_VARS,
  buildLegacyAliasDeclarations,
  buildThemeCssVariables,
  formatCssDeclarations,
  themeTokenRgbVar,
} from './themeCssVars'
import { toRgbTriple } from './themeColor'
import { DEFAULT_THEME_SEED, THEME_PRESETS, THEME_PRESET_IDS, deriveThemeTokens } from './themeEngine'

describe('themeCssVars', () => {
  it('新语义变量名与设计稿 vars() 规则一致', () => {
    expect(THEME_TOKEN_CSS_VARS.text1).toBe('--text1')
    expect(THEME_TOKEN_CSS_VARS.controlHover).toBe('--control-hover')
    expect(THEME_TOKEN_CSS_VARS.clipVideoLine).toBe('--clip-video-line')
    expect(themeTokenRgbVar('window')).toBe('--window-rgb')
  })

  it('运行时变量：每个令牌一个完整颜色，不透明令牌另出 r g b 三元组', () => {
    const tokens = deriveThemeTokens(DEFAULT_THEME_SEED)
    const vars = buildThemeCssVariables(tokens)
    expect(vars['--window']).toBe(tokens.colors.window)
    expect(vars['--window-rgb']).toBe(toRgbTriple(tokens.colors.window))
    expect(vars['--accent-rgb']).toBe(toRgbTriple(tokens.colors.accent))
    expect(vars['--panel-rgb']).toBe(toRgbTriple(tokens.colors.panel))
    expect(vars['--accent-tint']).toBe(tokens.colors.accentTint)
    expect(vars['--accent-tint-rgb']).toBeUndefined()
    expect(vars['--window-rgb']).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/)
  })

  it('旧别名不由运行时写入（否则内联样式会盖掉 data-ui-blur 退化规则与 CSS 别名）', () => {
    for (const id of THEME_PRESET_IDS) {
      const vars = buildThemeCssVariables(deriveThemeTokens(THEME_PRESETS[id].seed))
      for (const alias of LEGACY_THEME_CSS_ALIASES) {
        expect({ legacy: alias.legacy, written: alias.legacy in vars }).toEqual({ legacy: alias.legacy, written: false })
      }
    }
  })

  it('旧别名都指向运行时实际输出的新变量，且没有自引用', () => {
    const vars = buildThemeCssVariables(deriveThemeTokens(DEFAULT_THEME_SEED))
    const declarations = buildLegacyAliasDeclarations()
    expect(Object.keys(declarations)).toHaveLength(LEGACY_THEME_CSS_ALIASES.length)
    for (const [legacy, value] of Object.entries(declarations)) {
      const target = /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1]
      expect(target).toBeDefined()
      expect(target).not.toBe(legacy)
      expect({ legacy, target, emitted: target! in vars }).toEqual({ legacy, target, emitted: true })
    }
    expect(declarations['--app-rgb']).toBe('var(--window-rgb)')
    expect(declarations['--danger-rgb']).toBe('var(--danger-text-rgb)')
    expect(declarations['--ui-glass-tint']).toBe('var(--glass-tint)')
  })

  it('旧别名覆盖 1.1 第七节可一对一映射的全部变量', () => {
    const legacy = LEGACY_THEME_CSS_ALIASES.map((alias) => alias.legacy)
    for (const name of [
      '--app-rgb', '--bg-rgb', '--surface-rgb', '--layer-rgb', '--border-rgb', '--text-rgb', '--text-soft-rgb',
      '--text-muted-rgb', '--text-faint-rgb', '--brand-300-rgb', '--brand-500-rgb', '--brand-600-rgb', '--brand-700-rgb',
      '--danger-rgb', '--success-rgb', '--warning-rgb', '--ui-surface-panel', '--ui-surface-field', '--ui-border-soft',
      '--ui-border-strong', '--ui-glass-tint', '--ui-glass-edge', '--ui-glass-sheen', '--ui-glass-hover', '--ui-glass-press',
      '--ui-glass-selected', '--ui-glass-divider', '--ui-glass-control-tint', '--ui-glass-region-tint',
      '--ui-glass-surface-tint', '--ui-scrim-tint', '--ui-scrim-tint-soft',
    ]) {
      expect(legacy).toContain(name)
    }
  })

  it('格式化为 CSS 声明文本', () => {
    expect(formatCssDeclarations({ '--a': '1 2 3', '--b': 'var(--a)' })).toBe('  --a: 1 2 3;\n  --b: var(--a);')
  })
})
