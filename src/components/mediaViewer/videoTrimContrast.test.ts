import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import postcss from 'postcss'
import tailwindcss, { type Config } from 'tailwindcss'
// @ts-expect-error 正式 Tailwind 配置是 JS，测试实际 CSS 生成链。
import config from '../../../tailwind.config.js'
import { deriveThemeTokens, THEME_CONTRAST_LEVELS, THEME_PRESETS, THEME_PRESET_IDS } from '@/core/theme/themeEngine'
import { compositeOver, contrastRatio, withAlpha } from '@/core/theme/themeColor'
import { buildThemeCssVariables } from '@/core/theme/themeCssVars'

const viewer = readFileSync(new URL('./VideoViewerControls.tsx', import.meta.url), 'utf8')
const timeline = readFileSync(new URL('../../features/videoEdit/timeline/VideoEditTimelineInOut.tsx', import.meta.url), 'utf8')
const source = readFileSync(new URL('../../features/videoEdit/panels/VideoEditSourceInOut.tsx', import.meta.url), 'utf8')
const classesAfter = (text: string, marker: string) => {
  const classes = text.slice(text.indexOf(marker)).match(/className="([^"]+)"/)?.[1]
  if (!classes) throw new Error(`没有找到范围样式：${marker}`)
  return classes.split(' ')
}
const rangeClasses = [
  classesAfter(viewer, 'data-video-trim-range'),
  classesAfter(timeline, 'return <div data-video-edit-in-out-range'),
  classesAfter(source, 'return <div data-video-edit-source-in-out'),
]
const trackClass = viewer.match(/className="[^"]*\b(bg-text1\/\d+)[^"]*"/)?.[1]
const backgrounds = new Map<string, string>()
const borders = new Map<string, string>()

beforeAll(async () => {
  const css = await postcss([tailwindcss({ ...(config as Config), content: [{ raw: [viewer, timeline, source].join('\n') }] })])
    .process('@tailwind utilities;', { from: undefined })
  css.root.walkRules(rule => {
    rule.walkDecls('background-color', decl => { backgrounds.set(rule.selector, decl.value) })
    rule.walkDecls('border-color', decl => { borders.set(rule.selector, decl.value) })
  })
})

function cssColor(className: string | undefined, vars: Record<string, string>, colors = backgrounds): string {
  if (!className) throw new Error('缺少颜色类')
  const selector = `.${className.replace(/[:/]/g, '\\$&')}${className.startsWith('hover:') ? ':hover' : ''}`
  const declaration = colors.get(selector)
  if (!declaration) throw new Error(`Tailwind 没有生成颜色类 ${className}`)
  return declaration.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (_, name: string, fallback: string | undefined) => {
    const value = vars[name] ?? fallback
    if (!value) throw new Error(`主题没有定义 ${name}`)
    return value
  })
}

describe('裁剪与入出点范围的实际 CSS 合成对比度', () => {
  for (const preset of THEME_PRESET_IDS) {
    it.each(Object.values(THEME_CONTRAST_LEVELS))(`${preset}/%s：范围填充在玻璃和实底上至少 3:1`, contrast => {
      const tokens = deriveThemeTokens({ ...THEME_PRESETS[preset].seed, contrast })
      const vars = buildThemeCssVariables(tokens)
      const t = tokens.colors
      const viewerFill = cssColor(rangeClasses[0].find(name => name.startsWith('bg-')), vars)
      const viewerTrack = cssColor(trackClass, vars)
      const boundary = cssColor(rangeClasses[0].find(name => /^border-(?!x-)/.test(name)), vars, borders)
      // 遍历从全黑到全白的媒体亮度；同时覆盖关闭玻璃时的 panel 实底。
      const viewerBeds = [t.panel, ...Array.from({ length: 256 }, (_, value) =>
        compositeOver(t.glassTint, `rgb(${value},${value},${value})`))]
      const viewerRatios = viewerBeds.map(bed => {
        const track = compositeOver(viewerTrack, bed)
        return contrastRatio(compositeOver(viewerFill, track), track)
      })
      expect(Math.min(...viewerRatios)).toBeGreaterThanOrEqual(3)
      // 起止边界压在未播放轨道和已播放进度上都要可辨；填充不能替代边界读数。
      for (const bed of [t.accent, ...viewerBeds.map(value => compositeOver(viewerTrack, value))]) {
        expect(contrastRatio(boundary, bed)).toBeGreaterThanOrEqual(3)
      }
      // 时间线标尺与源监视器均依赖填充标出范围，透明端点只是命中区。
      for (const classes of rangeClasses.slice(1)) {
        for (const name of classes.filter(value => /^(hover:)?bg-/.test(value))) {
          const fill = cssColor(name, vars)
          for (const bed of [t.window, t.panel, t.raised]) {
            expect(contrastRatio(compositeOver(fill, bed), bed)).toBeGreaterThanOrEqual(3)
          }
        }
      }
    })
  }

  it('保留旧实测轨道，修复后的实际令牌合成值与 Node 回归夹具一致', () => {
    const cases = [
      { preset: 'graphite' as const, track: 'rgb(39,41,44)', fixed: 'rgb(168,169,170)' },
      { preset: 'paper' as const, track: 'rgb(219,221,225)', fixed: 'rgb(89,92,96)' },
    ]
    for (const { preset, track, fixed } of cases) {
      const tokens = deriveThemeTokens(THEME_PRESETS[preset].seed)
      const fill = cssColor(rangeClasses[0].find(name => name.startsWith('bg-')), buildThemeCssVariables(tokens))
      expect(compositeOver(fill, track)).toBe(compositeOver(fixed, track))
      expect(contrastRatio(compositeOver(fill, track), track)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(compositeOver(withAlpha(tokens.colors.text1, 0.3), track), track)).toBeLessThan(3)
      expect(contrastRatio(track, track)).toBe(1)
    }
  })
})
