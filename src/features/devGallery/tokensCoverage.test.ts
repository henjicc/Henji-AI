import { describe, expect, it } from 'vitest'
import * as styleTokens from '@/components/ui/styleTokens'
import * as motion from '@/components/ui/motion'
import * as icons from '@/core/theme/icons'
import { GALLERY_STYLE_TOKENS, GALLERY_TEXT_TOKENS, GALLERY_MOTION_TOKENS, GALLERY_ICON_TOKENS } from './galleryIndex'

describe('中心页令牌自动收集', () => {
  it('styleTokens 的每个 UI 导出都进入清单，排版类进入真实字号样本', () => {
    expect(GALLERY_STYLE_TOKENS.map(([name]) => name)).toEqual(Object.keys(styleTokens).filter(name => name.startsWith('UI_')))
    expect(GALLERY_TEXT_TOKENS.map(([name]) => name)).toEqual(Object.entries(styleTokens).filter(([name, value]) => name.startsWith('UI_TEXT_') && name.endsWith('_CLASS') && typeof value === 'string').map(([name]) => name))
    expect(GALLERY_TEXT_TOKENS.length).toBeGreaterThanOrEqual(9)
  })
  it('每个动效档位、别名与图标登记都进入中心页', () => {
    expect(GALLERY_MOTION_TOKENS.map(([name]) => name)).toEqual(Object.keys(motion).filter(name => name.startsWith('UI_')))
    expect(GALLERY_ICON_TOKENS.map(([name]) => name)).toEqual(Object.keys(icons))
    expect(GALLERY_MOTION_TOKENS.find(([name]) => name === 'UI_DURATION')?.[1]).toEqual(motion.UI_DURATION)
  })
})
