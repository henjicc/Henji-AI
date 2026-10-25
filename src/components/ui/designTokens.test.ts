import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import type { Config } from 'tailwindcss'
// @ts-expect-error 正式 Tailwind 配置是 JS，测试实际 CSS 生成链。
import config from '../../../tailwind.config.js'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { describe, expect, it } from 'vitest'

import { THEME_COLOR_TOKEN_NAMES } from '@/core/theme/themeEngine'
import { themeTokenCssVar } from '@/core/theme/themeCssVars'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { UI_DURATION, UI_DURATION_CLASS } from './motion'
import * as styleTokens from './styleTokens'
import { UI_MENU_ITEM_PADDING_X_PX, resolveMenuItemHorizontalChrome } from './dropdownUtils'
import { resolveIconButtonClass } from './primitiveInternals'
import {
  UI_CONTROL_HEIGHT_CLASS,
  UI_ICON_SIZE_CLASS,
  UI_RADIUS_CLASS,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_PANEL_TITLE_CLASS,
  UI_TEXT_SECONDARY_CLASS,
  UI_TEXT_SECTION_CLASS,
  UI_TEXT_TITLE_CLASS,
} from './styleTokens'

/*
 * 设计令牌接入（界面重设计 1.3）的静态契约：Tailwind 配置、index.css 与 TS 令牌三处必须对得上。
 * 这些错位都不会报错——引用了不存在的变量只会让颜色/圆角静默失效，漏登记的时长不会生成 CSS。
 */

const ROOT = path.resolve(__dirname, '../../..')
const tailwindConfig = fs.readFileSync(path.join(ROOT, 'tailwind.config.js'), 'utf8')
const indexCss = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
const mainTsx = fs.readFileSync(path.join(ROOT, 'src/main.tsx'), 'utf8')

function rootDeclarations(css: string): Map<string, string> {
  const block = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')))
  const declarations = new Map<string, string>()
  for (const match of block.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) declarations.set(match[1], match[2].trim())
  return declarations
}

function presetBlock(css: string, preset: string): Map<string, string> {
  const start = css.indexOf(`:root[data-ui-radius='${preset}'] {`)
  const block = css.slice(start, css.indexOf('}', start))
  const declarations = new Map<string, string>()
  for (const match of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) declarations.set(match[1], match[2].trim())
  return declarations
}

const rootVars = rootDeclarations(indexCss)

describe('设计令牌：Tailwind ↔ CSS 变量', () => {
  it('tailwind.config.js 引用的每个 CSS 变量都在 index.css :root 中有静态默认值', () => {
    const referenced = new Set([...tailwindConfig.matchAll(/(?:withOpacity|cssVar)\('(--[\w-]+)'\)|var\((--[\w-]+)\)/g)].map((m) => m[1] ?? m[2]))
    const missing = [...referenced].filter((name) => !name.startsWith('--tw-') && !rootVars.has(name))
    expect(missing).toEqual([])
  })

  it('每个主题颜色令牌都有同名的 Tailwind 颜色（命名 = CSS 变量名去掉 --；文字片段为 clip-title）', () => {
    const exceptions: Record<string, string> = {
      // 文字片段：bg-clip-text 与 background-clip 工具类同名，改叫 clip-title
      clipText: 'clip-text-rgb',
      clipTextLine: 'clip-text-line-rgb',
    }
    const notExposed = new Set([
      // 材质与遮罩由 .ui-glass / .ui-glass-scrim 类消费，阴影色由 shadow-* 档位消费
      'shade', 'glassTint', 'glassOverlayTint', 'glassEdge', 'glassSheen', 'glassHover', 'glassPressed', 'glassSelected', 'glassSelectedAccent',
      'glassDivider', 'glassControlTint', 'glassRegionTint', 'glassSurfaceTint',
    ])
    const missing = THEME_COLOR_TOKEN_NAMES.filter((name) => {
      if (notExposed.has(name)) return false
      const cssVar = themeTokenCssVar(name)
      const variable = exceptions[name] ? `--${exceptions[name]}` : null
      return ![`'${cssVar}-rgb'`, `'${cssVar}'`, variable ? `'${variable}'` : null]
        .filter(Boolean)
        .some((needle) => tailwindConfig.includes(needle as string))
    })
    expect(missing).toEqual([])
  })

  it('阴影颜色工具类不含 panel，shadow-panel 只表示浮层阴影档位', () => {
    expect(tailwindConfig).toMatch(/boxShadowColor:[\s\S]*panel: _panel/)
  })

  it('浮层/特效阴影颜色走主题令牌，不再写死黑色', () => {
    const shadows = tailwindConfig.slice(tailwindConfig.indexOf('boxShadow: {'), tailwindConfig.indexOf('transitionTimingFunction'))
    expect(shadows).not.toMatch(/rgb\(0 0 0/)
    expect(shadows).toMatch(/'node-error': '0 0 0 1px color-mix\(in srgb, var\(--danger\) 28%/)
    expect(rootVars.get('--shadow-overlay')).toContain('var(--shade)')
    expect(config.theme.boxShadow.panel).toBe('var(--shadow-overlay)')
    expect(indexCss).not.toContain('--ui-shadow-panel')
    expect(indexCss).toMatch(/\.ui-glass-elevated\s*\{[^}]*var\(--shadow-overlay\)/)
  })

  it('不再有旧主题的 dark.* 写死色组', () => {
    expect(tailwindConfig).not.toMatch(/'bg-secondary'|'text-secondary'/)
  })
})

describe('设计令牌：尺寸、圆角、动效、层级', () => {
  it('登记的间距、条带与文本高度都生成实际 CSS，条带复用同行控件尺寸', async () => {
    expect(styleTokens.UI_SPACING_SCALE).toEqual([2, 4, 6, 8, 12, 16, 20, 24, 32])
    const classes = [
      ...Object.values(styleTokens.UI_INLINE_GAP_CLASS),
      ...Object.values(styleTokens.UI_STACK_CLASS),
      ...Object.values(styleTokens.UI_BAND_HEIGHT_CLASS),
      ...Object.values(styleTokens.UI_BAND_MIN_HEIGHT_CLASS),
      ...Object.values(styleTokens.UI_TEXT_AREA_HEIGHT_CLASS),
      ...Object.values(styleTokens.UI_TRIGGER_PANEL_SIZE_CLASS),
    ].join(' ')
    const result = await postcss([tailwindcss({ ...(config as Config), content: [{ raw: classes }] })]).process('@tailwind utilities;', { from: undefined })
    const rules = new Map<string, Map<string, string>>()
    result.root.walkRules(rule => { const declarations = new Map<string, string>(); rule.walkDecls(decl => { declarations.set(decl.prop, decl.value) }); rules.set(rule.selector, declarations) })
    for (const band of Object.keys(styleTokens.UI_BAND_HEIGHT_CLASS)) {
      expect(rules.get(`.h-band-${band}`)?.get('height')).toBe(`var(--size-band-${band})`)
      expect(rules.get(`.min-h-band-${band}`)?.get('min-height')).toBe(`var(--size-band-${band})`)
    }
    expect(rootVars.get('--size-band-row')).toBe('var(--size-control-sm)')
    expect(rootVars.get('--size-band-tab')).toBe('var(--size-control-md)')
    expect(rootVars.get('--size-band-header')).toBe('var(--size-control-lg)')
    expect(indexCss).toContain('--dv-tabs-and-actions-container-height: var(--size-band-tab)')
    for (const height of Object.keys(styleTokens.UI_TEXT_AREA_HEIGHT_CLASS)) {
      expect(rules.get(`.min-h-textarea-${height}`)?.get('min-height')).toBe(`var(--size-textarea-${height})`)
    }
    // 面板的 clamp 及高度预算必须真实生成，不能只是 TS 字符串登记。
    expect([...rules.values()].filter(declarations => declarations.has('--trigger-panel-max-height'))).toHaveLength(5)
    // 菜单档与特殊面板档按内容定宽（w-max + 上限），其余三档按窗口 clamp。
    expect([...rules.values()].filter(declarations => declarations.get('width')?.includes('clamp('))).toHaveLength(3)
  })

  it('六档方形按钮实际生成的宽高使用同一变量，图标类与数值登记一致', async () => {
    const sizes = { '2xs': 20, xs: 24, sm: 28, md: 32, lg: 36, xl: 40 } as const
    const classes = Object.keys(sizes).flatMap(size => [`h-control-${size}`, `w-control-${size}`, `size-control-${size}`]).join(' ')
    const result = await postcss([tailwindcss({ ...(config as Config), content: [{ raw: classes }] })]).process('@tailwind utilities;', { from: undefined })
    const rules = new Map<string, Map<string, string>>()
    result.root.walkRules(rule => { const declarations = new Map<string, string>(); rule.walkDecls(decl => { declarations.set(decl.prop, decl.value) }); rules.set(rule.selector, declarations) })
    for (const [size, height] of Object.entries(sizes)) {
      expect(rootVars.get(`--size-control-${size}`)).toBe(`${height}px`)
      const square = rules.get(`.size-control-${size}`)
      expect(square?.get('height')).toBe(`var(--size-control-${size})`)
      expect(square?.get('width')).toBe(square?.get('height'))
      if (size === 'sm' || size === 'md' || size === 'lg') {
        expect(rules.get(`.h-control-${size}`)?.get('height')).toBe(square?.get('height'))
        expect(rules.get(`.w-control-${size}`)?.get('width')).toBe(square?.get('width'))
      }
    }
    for (const key of Object.keys(UI_ICON_SIZE) as Array<keyof typeof UI_ICON_SIZE>) expect(Number(UI_ICON_SIZE_CLASS[key].slice(5)) * 4).toBe(UI_ICON_SIZE[key])
  })

  it.each(['sm', 'md', 'lg'] as const)('图标按钮 %s 的宽高引用相同控件变量，调整高度不会变成长方形', (size) => {
    const tokens = resolveIconButtonClass({ size, tone: 'default', shape: 'square', on: false }).split(/\s+/)
    const height = tokens.find((token) => token.startsWith('h-control-'))
    expect(height).toBeDefined()
    const variable = `--size-${height!.slice(2)}`
    expect(rootVars.has(variable)).toBe(true)
    expect(tokens).toContain(`w-control-${size}`)
    expect(tokens.some((token) => /^w-\d/.test(token))).toBe(false)
  })

  it('最小图标按钮也随界面圆角预设变化', () => {
    const tokens = resolveIconButtonClass({ size: '2xs', tone: 'default', shape: 'square', on: false }).split(/\s+/)
    expect(tokens).toContain(UI_RADIUS_CLASS.control)
    expect(tokens).not.toContain('rounded')
  })

  it('控件高度 28/32/36 与圆角 6/8/12 是 CSS 变量，Tailwind 类指向它们', () => {
    expect(rootVars.get('--size-control-sm')).toBe('28px')
    expect(rootVars.get('--size-control-md')).toBe('32px')
    expect(rootVars.get('--size-control-lg')).toBe('36px')
    expect(rootVars.get('--radius-control')).toBe('6px')
    expect(rootVars.get('--radius-field')).toBe('8px')
    expect(rootVars.get('--radius-overlay')).toBe('12px')
    expect(UI_CONTROL_HEIGHT_CLASS).toEqual({ sm: 'h-control-sm', md: 'h-control-md', lg: 'h-control-lg' })
    expect(UI_RADIUS_CLASS).toEqual({ control: 'rounded-control', field: 'rounded-field', overlay: 'rounded-overlay' })
    // rounded-md/lg/xl 改指同一组变量：「界面圆角」设置才能作用到存量控件
    expect(tailwindConfig).toMatch(/md: 'var\(--radius-control\)'/)
    expect(tailwindConfig).toMatch(/lg: 'var\(--radius-field\)'/)
    expect(tailwindConfig).toMatch(/xl: 'var\(--radius-overlay\)'/)
  })

  it('圆角预设同时缩放界面控件与画布节点，且内层不大于外层', () => {
    for (const preset of ['compact', 'large']) {
      const values = presetBlock(indexCss, preset)
      const px = (name: string) => Number.parseFloat(values.get(name) ?? 'NaN')
      expect(px('--radius-control')).toBeLessThan(px('--radius-field'))
      expect(px('--radius-field')).toBeLessThan(px('--radius-overlay'))
      expect(values.has('--node-radius')).toBe(false)
    }
    expect(rootVars.get('--node-radius')).toBe('var(--radius-overlay)')
  })

  it('tailwind.config.js 登记了 120/180/240 时长档（Tailwind 默认没有，漏登记不生成 CSS）', () => {
    for (const ms of [UI_DURATION.fast, UI_DURATION.base, UI_DURATION.slow]) {
      expect(tailwindConfig).toContain(`${ms}: '${ms}ms'`)
    }
    expect(Object.values(UI_DURATION_CLASS)).toEqual(['duration-120', 'duration-180', 'duration-240', 'duration-500'])
  })

  it('Z_LAYERS 与 tailwind zIndex 镜像一致', () => {
    const block = tailwindConfig.slice(tailwindConfig.indexOf('zIndex: {'), tailwindConfig.indexOf('}', tailwindConfig.indexOf('zIndex: {')))
    const fromConfig = Object.fromEntries([...block.matchAll(/(\w+): '(\d+)'/g)].map((m) => [m[1], Number(m[2])]))
    expect(fromConfig).toEqual(Z_LAYERS)
  })
})

describe('设计令牌：字体与字号', () => {
  it('实际生成的正文及辅助字号均固定行高，不继承父级绝对行高', async () => {
    const sizes = { '2xs': [11, 16], xs: [12, 16], 13: [13, 20], sm: [14, 20], 15: [15, 22], base: [16, 24], xl: [20, 28], display: [40, 48] }
    const result = await postcss([tailwindcss({ ...(config as Config), content: [{ raw: Object.keys(sizes).map(key => `text-${key}`).join(' ') }] })]).process('@tailwind utilities;', { from: undefined })
    for (const [key, [size, lineHeight]] of Object.entries(sizes)) {
      const declarations = new Map<string, string>()
      result.root.walkRules(`.text-${key}`, rule => { rule.walkDecls(decl => { declarations.set(decl.prop, decl.value) }) })
      expect(declarations.get('font-size')).toBe(`${size}px`)
      expect(declarations.get('line-height')).toBe(`${lineHeight}px`)
    }
  })

  it('菜单测宽与实际生成的选项留白和透明边框一致', async () => {
    const result = await postcss([tailwindcss({ ...(config as Config), content: [{ raw: `${Object.values(styleTokens.UI_FIELD_PADDING_CLASS).join(' ')} border` }] })]).process('@tailwind utilities;', { from: undefined })
    const px = (value: string) => parseFloat(value) * (value.endsWith('rem') ? 16 : 1)
    let border = 0
    result.root.walkRules('.border', rule => { rule.walkDecls('border-width', decl => { border = px(decl.value) * 2 }) })
    for (const size of ['sm', 'md', 'lg'] as const) {
      let padding = 0
      result.root.walkRules(`.${styleTokens.UI_FIELD_PADDING_CLASS[size]}`, rule => { rule.walkDecls(decl => { padding += px(decl.value) }) })
      expect(UI_MENU_ITEM_PADDING_X_PX[size]).toBe(padding)
      expect(resolveMenuItemHorizontalChrome(size, 'none')).toBe(padding + border)
    }
  })

  it('未登记的默认字号、阴影、圆角和旧类不生成 CSS', async () => {
    const result = await postcss([tailwindcss({ ...(config as Config), content: [{ raw: 'text-14 text-4xs text-lg text-2xl shadow-lg shadow-2xl rounded rounded-sm rounded-2xl bg-veil-faint leading-5.5 text-sm shadow-panel rounded-control' }] })]).process('@tailwind utilities;', { from: undefined })
    const selectors: string[] = []
    result.root.walkRules(rule => { selectors.push(rule.selector) })
    expect(selectors).toEqual(expect.arrayContaining(['.text-sm', '.shadow-panel', '.rounded-control']))
    for (const name of ['text-14', 'text-4xs', 'text-lg', 'text-2xl', 'shadow-lg', 'shadow-2xl', 'rounded', 'rounded-sm', 'rounded-2xl', 'bg-veil-faint']) expect(selectors).not.toContain(`.${name}`)
    expect(result.css).not.toContain('line-height: 1.375rem')
  })

  it('已确认零消费的令牌不再导出或保留重复变量', () => {
    expect(styleTokens).not.toHaveProperty('UI_ACCENT_HEX')
    expect(styleTokens).not.toHaveProperty('UI_TEXT_LIGHT_HEX')
    expect(indexCss).not.toMatch(/--ui-radius-(lg|xl|2xl)/)
  })
  it('排版档位 20/600、16/600、14/500、13/400、12、11/500', () => {
    expect(UI_TEXT_TITLE_CLASS).toMatch(/^text-xl font-semibold /)
    expect(UI_TEXT_SECTION_CLASS).toMatch(/^text-base font-semibold /)
    expect(UI_TEXT_PANEL_TITLE_CLASS).toMatch(/^text-sm font-medium /)
    expect(UI_TEXT_BODY_CLASS).toMatch(/^text-13 /)
    expect(UI_TEXT_LABEL_CLASS).toMatch(/^text-13 font-medium /)
    expect(UI_TEXT_SECONDARY_CLASS).toMatch(/^text-xs /)
    expect(UI_TEXT_META_CLASS).toMatch(/^text-2xs font-medium text-text3$/)
  })

  it('Geist / Geist Mono 随包加载（不走网络字体），字体栈拉丁在前、中文回落系统字体', () => {
    expect(mainTsx).toContain("import '@fontsource-variable/geist'")
    expect(mainTsx).toContain("import '@fontsource-variable/geist-mono'")
    expect(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')).not.toMatch(/fonts\.googleapis|fonts\.gstatic/)
    const sans = tailwindConfig.slice(tailwindConfig.indexOf('sans: ['), tailwindConfig.indexOf('mono: ['))
    expect(sans.indexOf('Geist Variable')).toBeGreaterThan(-1)
    expect(sans.indexOf('Geist Variable')).toBeLessThan(sans.indexOf('Microsoft YaHei UI'))
    expect(tailwindConfig).toMatch(/mono: \[\s*'"Geist Mono Variable"'/)
  })

  it('正文基准字号 13px 只设在 body（html 保持 16px，rem 间距不变）', () => {
    expect(indexCss).toMatch(/\r?\nbody \{\r?\n {2}font-size: 13px;/)
    expect(indexCss).not.toMatch(/\nhtml \{[^}]*font-size/)
  })
})
