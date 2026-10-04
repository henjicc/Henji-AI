import { describe, expect, it } from 'vitest'

import { compositeOver, deltaEOK, withAlpha } from '@/core/theme/themeColor'
import { deriveThemeTokens, THEME_PRESET_IDS, THEME_PRESETS } from '@/core/theme/themeEngine'

import { NODE_ROW_CLASS, NODE_ROW_HOVER_CLASS } from './nodeControlStyles'

/** 1px 描边要一眼看出变化，静息与悬停描边的色差至少到这一档（原 line → line-strong 在石墨下只有约 0.03）。 */
const ROW_HOVER_BORDER_MIN_DELTA = 0.1

describe('画布节点参数行悬停（任务 4.3、5.4）', () => {
  it('悬停只加强描边、不换底色：行内取值触发器（raised / 悬停 control-hover）始终与行底可区分', () => {
    expect(NODE_ROW_HOVER_CLASS).toBe('hover:border-text3/45')
    expect(NODE_ROW_HOVER_CLASS).not.toMatch(/(^| )hover:bg-/)
    // 行自带一圈静息描边，悬停才有可加强的边
    expect(NODE_ROW_CLASS).toMatch(/(^| )border-line( |$)/)
  })

  it.each(THEME_PRESET_IDS)('%s：行底（window）与行内触发器静息（raised）、节点面板（panel）都可区分', (id) => {
    expect(NODE_ROW_CLASS).toMatch(/(^| )bg-window( |$)/)
    const t = deriveThemeTokens(THEME_PRESETS[id].seed).colors
    expect(deltaEOK(t.window, t.raised)).toBeGreaterThanOrEqual(0.02)
    expect(deltaEOK(t.window, t.panel)).toBeGreaterThanOrEqual(0.02)
  })

  it.each(THEME_PRESET_IDS)('%s：悬停描边与静息描边一眼可辨（5.2 转交：石墨下行悬停几乎看不出）', (id) => {
    const t = deriveThemeTokens(THEME_PRESETS[id].seed).colors
    const hoverBorder = compositeOver(withAlpha(t.text3, 0.45), t.window)
    expect(deltaEOK(hoverBorder, t.line)).toBeGreaterThanOrEqual(ROW_HOVER_BORDER_MIN_DELTA)
  })
})
