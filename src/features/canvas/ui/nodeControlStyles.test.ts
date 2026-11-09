import { describe, expect, it } from 'vitest'

import { deltaEOK } from '@/core/theme/themeColor'
import { deriveThemeTokens, THEME_PRESET_IDS, THEME_PRESETS } from '@/core/theme/themeEngine'

import { NODE_ROW_CLASS } from './nodeControlStyles'

describe('画布节点参数行', () => {
  it('行不再各自套框：节点已是卡片，同一层纵深只画一次边框', () => {
    expect(NODE_ROW_CLASS).not.toMatch(/(^| )border( |-)/)
    expect(NODE_ROW_CLASS).not.toMatch(/(^| )bg-/)
  })

  it.each(THEME_PRESET_IDS)('%s：行内静默触发器悬停出底（hover）与节点面板（panel）可区分', (id) => {
    const t = deriveThemeTokens(THEME_PRESETS[id].seed).colors
    expect(deltaEOK(t.hover, t.panel)).toBeGreaterThanOrEqual(0.02)
  })
})
