import { describe, expect, it } from 'vitest'

import {
  THEME_COMPONENT_CSS_VARS,
  THEME_TOKEN_CSS_VARS,
  buildComponentVarDeclarations,
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

  it('组件层变量不由运行时写入（否则内联样式会盖掉 data-ui-blur 退化规则）', () => {
    for (const id of THEME_PRESET_IDS) {
      const vars = buildThemeCssVariables(deriveThemeTokens(THEME_PRESETS[id].seed))
      for (const item of THEME_COMPONENT_CSS_VARS) {
        expect({ name: item.name, written: item.name in vars }).toEqual({ name: item.name, written: false })
      }
    }
  })

  it('组件层变量都指向运行时实际输出的语义变量，且没有自引用', () => {
    const vars = buildThemeCssVariables(deriveThemeTokens(DEFAULT_THEME_SEED))
    const declarations = buildComponentVarDeclarations()
    expect(Object.keys(declarations)).toHaveLength(THEME_COMPONENT_CSS_VARS.length)
    for (const [name, value] of Object.entries(declarations)) {
      const target = /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1]
      expect(target).toBeDefined()
      expect(target).not.toBe(name)
      expect({ name, target, emitted: target! in vars }).toEqual({ name, target, emitted: true })
    }
    expect(declarations['--ui-glass-tint']).toBe('var(--glass-tint)')
    expect(declarations['--ui-scrim-tint']).toBe('var(--scrim)')
  })

  it('1.1 旧变量别名已删除：--danger/success/warning-rgb 回到实底三元组，其余旧名不再输出', () => {
    const tokens = deriveThemeTokens(DEFAULT_THEME_SEED)
    const vars = buildThemeCssVariables(tokens)
    expect(vars['--danger-rgb']).toBe(toRgbTriple(tokens.colors.danger))
    expect(vars['--success-rgb']).toBe(toRgbTriple(tokens.colors.success))
    expect(vars['--warning-rgb']).toBe(toRgbTriple(tokens.colors.warning))
    for (const name of [
      '--app-rgb', '--bg-rgb', '--surface-rgb', '--layer-rgb', '--border-rgb', '--text-rgb', '--text-soft-rgb',
      '--text-muted-rgb', '--text-faint-rgb', '--brand-300-rgb', '--brand-500-rgb', '--brand-600-rgb', '--brand-700-rgb',
      '--ui-surface-panel', '--ui-surface-field', '--ui-border-soft', '--ui-border-strong',
    ]) {
      expect({ name, emitted: name in vars }).toEqual({ name, emitted: false })
    }
  })

  it('格式化为 CSS 声明文本', () => {
    expect(formatCssDeclarations({ '--a': '1 2 3', '--b': 'var(--a)' })).toBe('  --a: 1 2 3;\n  --b: var(--a);')
  })
})
