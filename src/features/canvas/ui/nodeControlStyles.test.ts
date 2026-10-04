import { describe, expect, it } from 'vitest'

import { deltaEOK } from '@/core/theme/themeColor'
import { deriveThemeTokens, THEME_PRESET_IDS, THEME_PRESETS } from '@/core/theme/themeEngine'

import { NODE_ROW_CLASS, NODE_ROW_HOVER_CLASS } from './nodeControlStyles'

describe('画布节点参数行悬停（任务 4.3）', () => {
  it('悬停只加强描边、不换底色：行内取值触发器（raised / 悬停 control-hover）始终与行底可区分', () => {
    expect(NODE_ROW_HOVER_CLASS).toBe('hover:border-line-strong')
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
})
