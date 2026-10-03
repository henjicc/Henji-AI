// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { APP_WINDOW_BACKGROUND_HEX } from './colorTokens'
import { buildComponentVarDeclarations, buildThemeCssVariables } from './themeCssVars'
import { DEFAULT_THEME_SEED, THEME_PRESETS, deriveThemeTokens } from './themeEngine'
import { THEME_FIRST_FRAME_STORAGE_KEY, createThemeFirstFrame } from './themeFirstFrame'

const ROOT = path.resolve(__dirname, '../../..')
const indexCss = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')

function declarationsBetween(css: string, marker: string): Record<string, string> {
  const start = css.indexOf(`/* ${marker}:start */`)
  const end = css.indexOf(`/* ${marker}:end */`)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const block = css.slice(start, end)
  return Object.fromEntries(
    [...block.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)].map((match) => [match[1], match[2].trim()])
  )
}

const graphite = deriveThemeTokens(DEFAULT_THEME_SEED)

describe('首帧静态默认值（防闪色）', () => {
  it('index.css 静态主题变量 = 石墨推导结果，玻璃组件层变量 = 组件变量表（不一致时用 buildThemeCssVariables 重新生成）', () => {
    expect(declarationsBetween(indexCss, 'theme-tokens')).toEqual(buildThemeCssVariables(graphite))
    expect(declarationsBetween(indexCss, 'theme-component-vars')).toEqual(buildComponentVarDeclarations())
    expect(indexCss).not.toContain('theme-legacy-aliases')
    expect(indexCss).toMatch(/:root \{\s*\/\*[\s\S]*?\*\/\s*color-scheme: dark;/)
  })

  it('色调预设 CSS 已删除；毛玻璃关闭规则只引用新变量', () => {
    expect(indexCss).not.toMatch(/:root\[data-theme-tone/)
    const blurOff = indexCss.slice(indexCss.indexOf(":root[data-ui-blur='off'] {"))
    const rule = blurOff.slice(0, blurOff.indexOf('}'))
    expect(rule).not.toMatch(/--(panel|border|surface|layer)-rgb/)
    expect(rule).toContain('var(--scrim-solid)')
  })

  it('主进程窗口底色与 index.html 首帧回退色 = 石墨 window', () => {
    expect(APP_WINDOW_BACKGROUND_HEX).toBe(graphite.colors.window)
    const fallbacks = [...indexHtml.matchAll(/var\(--window, (#[0-9A-Fa-f]{6})\)/g)].map((match) => match[1])
    expect(fallbacks.length).toBeGreaterThan(0)
    for (const value of fallbacks) {
      expect(value).toBe(graphite.colors.window)
    }
  })

  it('index.html 去掉了 class="dark" 与废弃的 localStorage.theme 脚本', () => {
    expect(indexHtml).not.toMatch(/<html[^>]*class=/)
    expect(indexHtml).not.toContain("getItem('theme')")
  })
})

describe('index.html 首帧主题脚本', () => {
  const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? ''
  const run = () => new Function(inlineScript)()
  const root = document.documentElement

  afterEach(() => {
    localStorage.clear()
    root.removeAttribute('style')
    root.removeAttribute('data-ui-radius')
    root.removeAttribute('data-ui-blur')
  })

  it('读取 themeFirstFrame 写入的缓存，把变量、color-scheme 与圆角/毛玻璃属性写回根节点', () => {
    expect(inlineScript).toContain(`'${THEME_FIRST_FRAME_STORAGE_KEY}'`)
    const paper = deriveThemeTokens(THEME_PRESETS.paper.seed)
    const vars = buildThemeCssVariables(paper)
    localStorage.setItem(
      THEME_FIRST_FRAME_STORAGE_KEY,
      JSON.stringify(createThemeFirstFrame(paper, vars, { uiRadiusPreset: 'large', uiBlurEnabled: false }))
    )
    run()
    expect(root.style.getPropertyValue('--window')).toBe(paper.colors.window)
    expect(root.style.getPropertyValue('--text1-rgb')).toBe(vars['--text1-rgb'])
    expect(root.style.colorScheme).toBe('light')
    expect(root.dataset.uiRadius).toBe('large')
    expect(root.dataset.uiBlur).toBe('off')
  })

  it('无缓存、缓存损坏或格式不符时不抛错也不写任何东西', () => {
    run()
    localStorage.setItem(THEME_FIRST_FRAME_STORAGE_KEY, '{not json')
    run()
    localStorage.setItem(THEME_FIRST_FRAME_STORAGE_KEY, JSON.stringify({ version: 2, vars: { '--window': 'x' } }))
    run()
    localStorage.setItem(THEME_FIRST_FRAME_STORAGE_KEY, JSON.stringify({ version: 1, vars: { color: 'red', '--window': 5 } }))
    run()
    expect(root.getAttribute('style')).toBeNull()
  })
})
