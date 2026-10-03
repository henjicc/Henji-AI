// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { applyRuntimeTheme } from './runtimeTheme'
import { THEME_COMPONENT_CSS_VARS, buildThemeCssVariables } from './themeCssVars'
import { DEFAULT_THEME_SEED, THEME_PRESETS, deriveThemeTokens } from './themeEngine'
import { THEME_FIRST_FRAME_STORAGE_KEY } from './themeFirstFrame'
import { getThemeTokens, subscribeThemeTokens } from './themeTokenStore'

describe('applyRuntimeTheme', () => {
  const root = document.createElement('div')

  afterEach(() => {
    root.removeAttribute('style')
    root.removeAttribute('data-ui-radius')
    root.removeAttribute('data-ui-blur')
    root.removeAttribute('data-theme-tone')
    localStorage.clear()
    applyRuntimeTheme({ seed: DEFAULT_THEME_SEED, uiRadiusPreset: 'default', uiBlurEnabled: true }, root)
  })

  it('种子 + 覆盖 → 令牌 → 根节点语义变量与 color-scheme；不写组件层变量', () => {
    const overrides = { canvas: deriveThemeTokens(THEME_PRESETS.paper.seed).colors.panel }
    const tokens = applyRuntimeTheme({ seed: THEME_PRESETS.paper.seed, overrides, uiRadiusPreset: 'default', uiBlurEnabled: true }, root)
    expect(tokens.colors.canvas).toBe(overrides.canvas)
    const expected = buildThemeCssVariables(deriveThemeTokens(THEME_PRESETS.paper.seed, overrides))
    for (const [name, value] of Object.entries(expected)) {
      expect({ name, value: root.style.getPropertyValue(name) }).toEqual({ name, value })
    }
    expect(root.style.colorScheme).toBe('light')
    for (const item of THEME_COMPONENT_CSS_VARS) {
      expect(root.style.getPropertyValue(item.name)).toBe('')
    }
  })

  it('清掉旧版本运行时残留的内联组件层变量与 data-theme-tone', () => {
    root.style.setProperty('--ui-glass-tint', 'red')
    root.dataset.themeTone = 'warm'
    applyRuntimeTheme({ seed: DEFAULT_THEME_SEED, uiRadiusPreset: 'default', uiBlurEnabled: true }, root)
    expect(root.style.getPropertyValue('--ui-glass-tint')).toBe('')
    expect(root.dataset.themeTone).toBeUndefined()
  })

  it('同步圆角与毛玻璃属性', () => {
    applyRuntimeTheme({ seed: DEFAULT_THEME_SEED, uiRadiusPreset: 'compact', uiBlurEnabled: false }, root)
    expect(root.dataset.uiRadius).toBe('compact')
    expect(root.dataset.uiBlur).toBe('off')
    applyRuntimeTheme({ seed: DEFAULT_THEME_SEED, uiRadiusPreset: 'default', uiBlurEnabled: true }, root)
    expect(root.dataset.uiRadius).toBeUndefined()
    expect(root.dataset.uiBlur).toBeUndefined()
  })

  it('发布令牌给非 DOM 渲染面，并写首帧缓存', () => {
    const seen: string[] = []
    const unsubscribe = subscribeThemeTokens((tokens) => seen.push(tokens.colors.window))
    const ocean = applyRuntimeTheme({ seed: THEME_PRESETS.ocean.seed, uiRadiusPreset: 'large', uiBlurEnabled: true }, root)
    unsubscribe()
    expect(getThemeTokens().colors.window).toBe(ocean.colors.window)
    expect(seen).toEqual([ocean.colors.window])
    const cached = JSON.parse(localStorage.getItem(THEME_FIRST_FRAME_STORAGE_KEY) ?? 'null')
    expect(cached).toMatchObject({ version: 1, colorScheme: 'dark', uiRadius: 'large' })
    expect(cached.vars['--window']).toBe(ocean.colors.window)
  })
})
